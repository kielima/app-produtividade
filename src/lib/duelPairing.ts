import { DEFAULT_RATING, type GlickoRating } from './glicko2';

/**
 * Escolhe o próximo par de projetos para duelo.
 *
 * Heurística:
 *   - Primeiro projeto: peso proporcional ao RD (precisa de mais duelos =
 *     mais peso) somado a um floor pra novatos não monopolizarem.
 *   - Segundo projeto: dos demais, peso ∝ rd * exp(-(|Δr|/200)^2), favorecendo
 *     RDs altos E ratings próximos (duelos informativos).
 *   - Evita repetir o par imediatamente anterior, se possível.
 */
export interface PairingInput {
  candidateIds: ReadonlyArray<string>;
  ratings: Readonly<Record<string, GlickoRating>>;
  lastPair?: readonly [string, string] | null;
  /** Hook pra teste/determinismo; default Math.random. */
  rng?: () => number;
}

export type Pair = readonly [string, string];

function weightedPick(
  ids: ReadonlyArray<string>,
  weights: ReadonlyArray<number>,
  rng: () => number,
): string | null {
  if (ids.length === 0) return null;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return ids[Math.floor(rng() * ids.length)] ?? null;
  let pick = rng() * total;
  for (let i = 0; i < ids.length; i++) {
    pick -= weights[i]!;
    if (pick <= 0) return ids[i]!;
  }
  return ids[ids.length - 1]!;
}

function ratingOf(
  ratings: Readonly<Record<string, GlickoRating>>,
  id: string,
): GlickoRating {
  return ratings[id] ?? DEFAULT_RATING;
}

export function pickNextPair(input: PairingInput): Pair | null {
  const { candidateIds, ratings, lastPair = null, rng = Math.random } = input;
  if (candidateIds.length < 2) return null;

  // Peso quadrático no RD: projetos com baixa confiabilidade (RD alto)
  // ganham preferência muito maior do que com peso linear.
  const firstWeights = candidateIds.map((id) => {
    const rd = ratingOf(ratings, id).rd;
    return Math.pow(Math.max(rd, 50), 2);
  });
  const first = weightedPick(candidateIds, firstWeights, rng);
  if (!first) return null;

  const firstR = ratingOf(ratings, first).r;
  const rest = candidateIds.filter((id) => id !== first);
  const secondWeights = rest.map((id) => {
    const rating = ratingOf(ratings, id);
    const diff = Math.abs(rating.r - firstR);
    const proximity = Math.exp(-Math.pow(diff / 200, 2));
    let w = Math.pow(Math.max(rating.rd, 50), 2) * proximity;
    // Penaliza repetir o par anterior (não bane, só reduz a chance).
    if (
      lastPair &&
      ((lastPair[0] === first && lastPair[1] === id) ||
        (lastPair[1] === first && lastPair[0] === id))
    ) {
      w *= 0.1;
    }
    return w;
  });
  const second = weightedPick(rest, secondWeights, rng);
  if (!second) return null;

  return [first, second] as const;
}

/**
 * Após uma sessão de duelos, retorna a ordem final dos projetos:
 *   - Ativos ordenados por rating decrescente
 *   - Não-ativos preservados no fim na ordem em que vieram
 *
 * `activeIds` define quem participa do ranking pelo rating; o restante
 * é tratado como "fora do jogo" e simplesmente vai pro fim.
 */
export function reorderByRating(
  allProjectIds: ReadonlyArray<string>,
  activeIds: ReadonlySet<string>,
  ratings: Readonly<Record<string, GlickoRating>>,
): string[] {
  const active = allProjectIds.filter((id) => activeIds.has(id));
  const inactive = allProjectIds.filter((id) => !activeIds.has(id));
  active.sort((a, b) => ratingOf(ratings, b).r - ratingOf(ratings, a).r);
  return [...active, ...inactive];
}

/** Faixa de duelos por sessão, modulada pela confiança média. */
export const MIN_DUEL_LIMIT = 5;
export const MAX_DUEL_LIMIT = 15;
/** Âncoras de RD para a interpolação linear (ver `classifyConfidence`). */
const HIGH_CONFIDENCE_RD = 80;
const LOW_CONFIDENCE_RD = 200;

/**
 * Limite recomendado de duelos por sessão na faixa
 * [`MIN_DUEL_LIMIT`, `MAX_DUEL_LIMIT`], em função do RD médio dos projetos
 * ativos (proxy da confiança nos ratings):
 *   - RD médio ≤ 80  (alta confiança)  → mínimo (poucos duelos bastam)
 *   - RD médio ≥ 200 (baixa confiança) → máximo (precisa duelar mais)
 *   - Entre 80 e 200: interpolação linear.
 *
 * Projetos sem rating persistido entram com o `DEFAULT_RATING` (rd=350),
 * o que naturalmente puxa o limite pro topo da faixa em cold start.
 */
export function recommendedDuelLimit(
  activeIds: ReadonlyArray<string>,
  ratings: Readonly<Record<string, GlickoRating>>,
): number {
  if (activeIds.length === 0) return MIN_DUEL_LIMIT;
  let total = 0;
  for (const id of activeIds) total += ratingOf(ratings, id).rd;
  const avgRd = total / activeIds.length;
  const span = LOW_CONFIDENCE_RD - HIGH_CONFIDENCE_RD;
  const t = Math.min(1, Math.max(0, (avgRd - HIGH_CONFIDENCE_RD) / span));
  return Math.round(MIN_DUEL_LIMIT + t * (MAX_DUEL_LIMIT - MIN_DUEL_LIMIT));
}

export interface DuelSummary {
  /** Top 3 subidas: maior delta de posição (positivo = subiu). */
  risers: Array<{ id: string; delta: number }>;
  /** Top 3 descidas (delta negativo). */
  fallers: Array<{ id: string; delta: number }>;
  /** Primeiros 3 da nova ordem (líderes atuais). */
  newTop: string[];
}

/**
 * Compara a ordem inicial com a final e extrai os movimentos mais
 * significativos. Projetos que não estão em ambas as listas são ignorados.
 */
export function summarizeChanges(
  initialOrder: ReadonlyArray<string>,
  newOrder: ReadonlyArray<string>,
): DuelSummary {
  const oldIdx = new Map(initialOrder.map((id, i) => [id, i]));
  const newIdx = new Map(newOrder.map((id, i) => [id, i]));
  const deltas: Array<{ id: string; delta: number }> = [];
  for (const id of initialOrder) {
    const o = oldIdx.get(id)!;
    const n = newIdx.get(id);
    if (n === undefined) continue;
    deltas.push({ id, delta: o - n });
  }
  const risers = deltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  const fallers = deltas
    .filter((d) => d.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);
  const newTop = newOrder.slice(0, 3);
  return { risers, fallers, newTop };
}
