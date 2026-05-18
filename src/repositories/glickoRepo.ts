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
  recordDuel as glickoRecordDuel,
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
 * Aplica um duelo e persiste os dois ratings num único batch.
 * Usa os ratings *passados* como ponto de partida — quem chama deve
 * fornecer os mais recentes (do snapshot live ou de uma leitura).
 */
export async function recordDuelAndPersist(
  uid: string,
  winnerId: string,
  winnerRating: GlickoRating,
  loserId: string,
  loserRating: GlickoRating,
): Promise<{ winner: GlickoRating; loser: GlickoRating }> {
  const { winner, loser } = glickoRecordDuel(winnerRating, loserRating);
  const w = sanitize(winner);
  const l = sanitize(loser);
  const batch = writeBatch(db);
  batch.set(glickoDoc(uid, winnerId), w, { merge: true });
  batch.set(glickoDoc(uid, loserId), l, { merge: true });
  await batch.commit();
  return { winner: w, loser: l };
}

/**
 * Desfaz um duelo restaurando os ratings *anteriores* dos dois projetos.
 * Quem chama deve fornecer o snapshot capturado antes do duelo.
 */
export async function revertDuelAndPersist(
  uid: string,
  aId: string,
  aRatingBefore: GlickoRating,
  bId: string,
  bRatingBefore: GlickoRating,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(glickoDoc(uid, aId), sanitize(aRatingBefore), { merge: true });
  batch.set(glickoDoc(uid, bId), sanitize(bRatingBefore), { merge: true });
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
