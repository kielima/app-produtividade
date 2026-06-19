import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  DEFAULT_RATING,
  clampRD,
  type GlickoRating,
} from '../lib/glicko2';

/**
 * Persistência dos ratings Glicko-2 dos projetos, em coleção própria
 * (`users/{uid}/glicko/{projectId}`). Fica isolada da coleção `projects`
 * para que a matemática do duelo NUNCA contamine os campos do projeto
 * em si — a única ponte é a ordem da lista (campo `order`).
 */

function glickoCol(uid: string) {
  return collection(db, 'users', uid, 'glicko');
}

function glickoDoc(uid: string, projectId: string) {
  return doc(db, 'users', uid, 'glicko', projectId);
}

export type GlickoMap = Record<string, GlickoRating>;

export function subscribeToGlickoRatings(
  uid: string,
  cb: (ratings: GlickoMap) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    glickoCol(uid),
    (snap) => {
      const out: GlickoMap = {};
      snap.forEach((d) => {
        const data = d.data() as Partial<GlickoRating>;
        out[d.id] = {
          r: typeof data.r === 'number' ? data.r : DEFAULT_RATING.r,
          rd: typeof data.rd === 'number' ? data.rd : DEFAULT_RATING.rd,
          sigma:
            typeof data.sigma === 'number' ? data.sigma : DEFAULT_RATING.sigma,
        };
      });
      cb(out);
    },
    (err) => onError?.(err),
  );
}

export async function getRatingOrDefault(
  uid: string,
  projectId: string,
): Promise<GlickoRating> {
  const snap = await getDoc(glickoDoc(uid, projectId));
  if (!snap.exists()) return { ...DEFAULT_RATING };
  const data = snap.data() as Partial<GlickoRating>;
  return {
    r: typeof data.r === 'number' ? data.r : DEFAULT_RATING.r,
    rd: typeof data.rd === 'number' ? data.rd : DEFAULT_RATING.rd,
    sigma:
      typeof data.sigma === 'number' ? data.sigma : DEFAULT_RATING.sigma,
  };
}

function sanitize(r: GlickoRating): GlickoRating {
  return { r: r.r, rd: clampRD(r.rd), sigma: r.sigma };
}

/**
 * Persiste, num único batch, os ratings finais de uma sessão de duelos.
 * Recebe o mapa de projetos que mudaram (tipicamente a saída de
 * `applySessionDuels`). Não escreve nada se o mapa estiver vazio.
 */
export async function persistRatings(
  uid: string,
  ratings: GlickoMap,
): Promise<void> {
  const entries = Object.entries(ratings);
  if (entries.length === 0) return;
  const batch = writeBatch(db);
  for (const [id, rating] of entries) {
    batch.set(glickoDoc(uid, id), sanitize(rating), { merge: true });
  }
  await batch.commit();
}

/**
 * Retorna ratings para uma lista de projetos, usando o default para os
 * que ainda não têm rating persistido. Não persiste — útil para ler e
 * ordenar sem efeitos colaterais.
 */
export function ratingsFor(
  ratings: GlickoMap,
  projectIds: ReadonlyArray<string>,
): Record<string, GlickoRating> {
  const out: Record<string, GlickoRating> = {};
  for (const id of projectIds) {
    out[id] = ratings[id] ?? { ...DEFAULT_RATING };
  }
  return out;
}
