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

/**
 * Constante τ do sistema: governa quão rápido a volatilidade σ reage. Faixa
 * típica 0.3..1.2 — valores baixos deixam σ "pegajoso" (quase nunca muda),
 * altos fazem σ reagir depressa a viradas de prioridade. Usamos 0.9 para que
 * o badge de volatilidade seja informativo no uso real do app.
 *
 * `updateRating`/`recordDuel` aceitam um τ explícito; o default é esta
 * constante. (O teste do exemplo canônico do paper fixa τ=0.5.)
 */
export const TAU = 0.9;

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
  tau: number,
): number {
  const a = Math.log(sigma * sigma);

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
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

export interface MatchOutcome {
  /** 1 = vitória, 0 = derrota, 0.5 = empate */
  score: number;
  opponent: GlickoRating;
}

/**
 * Atualiza um rating após uma "rating period" composta por uma ou mais
 * partidas. Uma sessão inteira de duelos é tratada como UMA period (ver
 * `applySessionDuels`), o que é a forma correta de o Glicko-2 medir
 * volatilidade — daí `matches` aceitar vários jogos de uma vez.
 *
 * `tau` controla a reatividade da volatilidade; default = constante `TAU`.
 */
export function updateRating(
  rating: GlickoRating,
  matches: ReadonlyArray<MatchOutcome>,
  tau: number = TAU,
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

  const sigmaPrime = solveVolatility(rating.sigma, phi, v, delta, tau);
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
  tau: number = TAU,
): { winner: GlickoRating; loser: GlickoRating } {
  const winnerNext = updateRating(winner, [{ score: 1, opponent: loser }], tau);
  const loserNext = updateRating(loser, [{ score: 0, opponent: winner }], tau);
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
 * Limiares para classificar a volatilidade. `sigma < lowMax` → baixa;
 * `sigma >= highMin` → alta; entre os dois → média. (lowMax ≤ highMin)
 */
export interface VolatilityBands {
  lowMax: number;
  highMin: number;
}

/**
 * Bandas fixas de fallback (calibradas em torno do default σ=0.06), usadas
 * quando ainda não há população suficiente para derivar bandas adaptativas.
 */
export const DEFAULT_VOLATILITY_BANDS: VolatilityBands = Object.freeze({
  lowMax: 0.055,
  highMin: 0.075,
});

/**
 * Abaixo deste espalhamento (max−min) consideramos a população praticamente
 * uniforme: ninguém se destaca, então todos caem em "média".
 */
const MIN_VOLATILITY_SPREAD = 1e-4;

/** Quantil (interpolação linear) de um array JÁ ordenado de forma crescente. */
function quantile(sorted: ReadonlyArray<number>, q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Deriva bandas de volatilidade ADAPTATIVAS a partir da população atual de
 * σ: divide em terços (tercis), de modo que o terço mais baixo leia "baixa"
 * e o mais alto "alta". Conforme os σ mudam, as bandas se reajustam sozinhas.
 *
 * Casos de borda:
 *   - menos de 3 valores → cai nas bandas fixas (`DEFAULT_VOLATILITY_BANDS`);
 *   - população quase uniforme (espalhamento < `MIN_VOLATILITY_SPREAD`) →
 *     bandas que fazem todos lerem "média".
 */
export function computeVolatilityBands(
  sigmas: ReadonlyArray<number>,
): VolatilityBands {
  const vals = sigmas
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);
  if (vals.length < 3) return { ...DEFAULT_VOLATILITY_BANDS };

  const min = vals[0]!;
  const max = vals[vals.length - 1]!;
  if (max - min < MIN_VOLATILITY_SPREAD) {
    return {
      lowMax: min - MIN_VOLATILITY_SPREAD,
      highMin: max + MIN_VOLATILITY_SPREAD,
    };
  }
  return { lowMax: quantile(vals, 1 / 3), highMin: quantile(vals, 2 / 3) };
}

/**
 * Classifica a volatilidade σ em baixa/média/alta usando as `bands`
 * fornecidas (tipicamente vindas de `computeVolatilityBands`). Sem bandas,
 * usa as fixas de fallback.
 */
export function classifyVolatility(
  sigma: number,
  bands: VolatilityBands = DEFAULT_VOLATILITY_BANDS,
): VolatilityLevel {
  if (sigma < bands.lowMax) return 'baixa';
  if (sigma < bands.highMin) return 'média';
  return 'alta';
}

export type ConfidenceLevel = 'baixa' | 'média' | 'alta';

/**
 * Classifica a confiança no rating com base no RD (rating deviation).
 * RD vive entre ~30 (clamp inferior) e 350 (default máximo); menor RD
 * = posição mais bem estabelecida.
 *   - alta  : rd ≤ 80   → muitos duelos, posição estável
 *   - média : 80 < rd ≤ 200 → sinal razoável, ainda oscila
 *   - baixa : rd > 200  → poucos duelos / projeto novo
 */
export function classifyConfidence(rd: number): ConfidenceLevel {
  if (rd <= 80) return 'alta';
  if (rd <= 200) return 'média';
  return 'baixa';
}
