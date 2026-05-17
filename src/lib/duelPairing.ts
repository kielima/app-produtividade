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

  const firstWeights = candidateIds.map((id) => {
    const rd = ratingOf(ratings, id).rd;
    return Math.max(rd, 50); // floor pra todos terem alguma chance
  });
  const first = weightedPick(candidateIds, firstWeights, rng);
  if (!first) return null;

  const firstR = ratingOf(ratings, first).r;
  const rest = candidateIds.filter((id) => id !== first);
  const secondWeights = rest.map((id) => {
    const rating = ratingOf(ratings, id);
    const diff = Math.abs(rating.r - firstR);
    const proximity = Math.exp(-Math.pow(diff / 200, 2));
    let w = Math.max(rating.rd, 50) * proximity;
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
