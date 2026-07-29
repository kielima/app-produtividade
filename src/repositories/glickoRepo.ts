import { supabase } from '../lib/supabase';
import { DEFAULT_RATING, clampRD, type GlickoRating } from '../lib/glicko2';
import { subscribeTable, type Unsubscribe } from './realtimeTable';

/**
 * Persistência dos ratings Glicko-2 dos projetos, em tabela própria
 * (`project_ratings`, PK = project_id). Fica isolada da tabela `projects`
 * para que a matemática do duelo NUNCA contamine os campos do projeto em si
 * — a única ponte é a ordem da lista (campo `order`).
 */

interface RatingRow {
  project_id: string;
  user_id: string;
  r: number;
  rd: number;
  sigma: number;
}

export type GlickoMap = Record<string, GlickoRating>;

function rowToRating(row: RatingRow): GlickoRating {
  return {
    r: typeof row.r === 'number' ? row.r : DEFAULT_RATING.r,
    rd: typeof row.rd === 'number' ? row.rd : DEFAULT_RATING.rd,
    sigma: typeof row.sigma === 'number' ? row.sigma : DEFAULT_RATING.sigma,
  };
}

export function subscribeToGlickoRatings(
  uid: string,
  cb: (ratings: GlickoMap) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<RatingRow, { id: string; rating: GlickoRating }>(
    {
      table: 'project_ratings',
      uid,
      rowIdColumn: 'project_id',
      mapRow: (row) => ({ id: row.project_id, rating: rowToRating(row) }),
      idOf: (item) => item.id,
      onError,
    },
    (items) => {
      const out: GlickoMap = {};
      for (const item of items) out[item.id] = item.rating;
      cb(out);
    },
  );
}

export async function getRatingOrDefault(uid: string, projectId: string): Promise<GlickoRating> {
  const { data } = await supabase
    .from('project_ratings')
    .select('r, rd, sigma')
    .eq('user_id', uid)
    .eq('project_id', projectId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_RATING };
  return rowToRating({ ...data, project_id: projectId, user_id: uid });
}

function sanitize(r: GlickoRating): GlickoRating {
  return { r: r.r, rd: clampRD(r.rd), sigma: r.sigma };
}

/**
 * Persiste, num único upsert, os ratings finais de uma sessão de duelos.
 */
export async function persistRatings(uid: string, ratings: GlickoMap): Promise<void> {
  const entries = Object.entries(ratings);
  if (entries.length === 0) return;
  const rows = entries.map(([projectId, rating]) => {
    const s = sanitize(rating);
    return { project_id: projectId, user_id: uid, r: s.r, rd: s.rd, sigma: s.sigma };
  });
  const { error } = await supabase.from('project_ratings').upsert(rows);
  if (error) throw new Error(error.message);
}

/**
 * Retorna ratings para uma lista de projetos, usando o default para os que
 * ainda não têm rating persistido. Não persiste.
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
