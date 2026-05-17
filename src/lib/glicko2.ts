/**
 * Glicko-2 (Glickman 2013) — implementação pura, sem React/Firebase.
 *
 * Usado apenas para REORDENAR a lista de projetos. Os números deste módulo
 * (rating R, deviation RD, volatility σ) nunca se misturam com o score de
 * tarefas. A única coisa que sai daqui pro resto do app é a *ordem* dos
 * projetos por R decrescente — e essa ordem alimenta o `buildProjectScoreMap`
 * existente, intocado.
 *
 * Referência: http://www.glicko.net/glicko/glicko2.pdf
 */

export interface GlickoRating {
  /** Rating na escala humana (default 1500). */
  r: number;
  /** Rating deviation: incerteza (default 350). */
  rd: number;
  /** Volatilidade (default 0.06). */
  sigma: number;
}

export const DEFAULT_RATING: GlickoRating = Object.freeze({
  r: 1500,
  rd: 350,
  sigma: 0.06,
});

/** Constante τ do sistema. 0.3..1.2 é típico; 0.5 dá bom equilíbrio. */
export const TAU = 0.5;

const EPSILON = 1e-6;
const SCALE = 173.7178;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Resolve f(x) = 0 pelo algoritmo Illinois (variante de regula falsi)
 * para encontrar a nova volatilidade. Convergência garantida.
 */
function solveVolatility(
  sigma: number,
  phi: number,
  v: number,
  delta: number,
): number {
  const a = Math.log(sigma * sigma);

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

interface MatchOutcome {
  /** 1 = vitória, 0 = derrota, 0.5 = empate */
  score: number;
  opponent: GlickoRating;
}

/**
 * Atualiza um rating após uma "rating period" composta por uma ou mais
 * partidas. Para o caso típico do app, cada duelo é uma period com 1 jogo.
 */
export function updateRating(
  rating: GlickoRating,
  matches: ReadonlyArray<MatchOutcome>,
): GlickoRating {
  const mu = (rating.r - 1500) / SCALE;
  const phi = rating.rd / SCALE;

  // Sem jogos: só infla o RD pela volatilidade.
  if (matches.length === 0) {
    const phiPrime = Math.sqrt(phi * phi + rating.sigma * rating.sigma);
    return { r: rating.r, rd: SCALE * phiPrime, sigma: rating.sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const m of matches) {
    const muJ = (m.opponent.r - 1500) / SCALE;
    const phiJ = m.opponent.rd / SCALE;
    const gj = g(phiJ);
    const Ej = expectedScore(mu, muJ, phiJ);
    vInv += gj * gj * Ej * (1 - Ej);
    deltaSum += gj * (m.score - Ej);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  const sigmaPrime = solveVolatility(rating.sigma, phi, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return {
    r: SCALE * muPrime + 1500,
    rd: SCALE * phiPrime,
    sigma: sigmaPrime,
  };
}

/**
 * Atalho para um único duelo: aplica o resultado em ambos os jogadores
 * usando seus estados originais (avaliação simultânea — não usa o estado
 * já atualizado do vencedor para recalcular o perdedor).
 */
export function recordDuel(
  winner: GlickoRating,
  loser: GlickoRating,
): { winner: GlickoRating; loser: GlickoRating } {
  const winnerNext = updateRating(winner, [{ score: 1, opponent: loser }]);
  const loserNext = updateRating(loser, [{ score: 0, opponent: winner }]);
  return { winner: winnerNext, loser: loserNext };
}

/**
 * Clampa o RD a uma faixa razoável. RD nunca deve voltar a "350" depois
 * de muitas partidas (overinflation por tempo), nem cair abaixo de ~30
 * (precisão excessiva).
 */
export function clampRD(rd: number, max = 350, min = 30): number {
  if (rd > max) return max;
  if (rd < min) return min;
  return rd;
}

export type VolatilityLevel = 'baixa' | 'média' | 'alta';

/**
 * Classifica a volatilidade σ em três faixas, calibradas em torno do
 * default 0.06:
 *   - baixa  : σ < 0.055  → desempenho consistente
 *   - média  : 0.055..0.075 → variação normal
 *   - alta   : σ ≥ 0.075  → resultados erráticos / em transição
 */
export function classifyVolatility(sigma: number): VolatilityLevel {
  if (sigma < 0.055) return 'baixa';
  if (sigma < 0.075) return 'média';
  return 'alta';
}
