import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING,
  classifyConfidence,
  classifyVolatility,
  clampRD,
  recordDuel,
  updateRating,
  type GlickoRating,
} from './glicko2';

describe('Glicko-2', () => {
  it('reproduces the canonical example from Glickman 2013', () => {
    // Exemplo da Seção "Example" do paper:
    // Player: r=1500, RD=200, sigma=0.06
    // Opponents: (1400,30) win, (1550,100) loss, (1700,300) loss
    const player: GlickoRating = { r: 1500, rd: 200, sigma: 0.06 };
    const next = updateRating(player, [
      { score: 1, opponent: { r: 1400, rd: 30, sigma: 0.06 } },
      { score: 0, opponent: { r: 1550, rd: 100, sigma: 0.06 } },
      { score: 0, opponent: { r: 1700, rd: 300, sigma: 0.06 } },
    ]);
    // Esperados do paper: r' ≈ 1464.06, RD' ≈ 151.52, σ' ≈ 0.05999
    expect(next.r).toBeCloseTo(1464.06, 1);
    expect(next.rd).toBeCloseTo(151.52, 1);
    expect(next.sigma).toBeCloseTo(0.05999, 4);
  });

  it('inflates RD when there are no games in the period', () => {
    const player: GlickoRating = { r: 1500, rd: 200, sigma: 0.06 };
    const next = updateRating(player, []);
    expect(next.r).toBe(1500);
    expect(next.sigma).toBe(0.06);
    expect(next.rd).toBeGreaterThan(200);
  });

  it('moves winner up and loser down on a single duel', () => {
    const a = DEFAULT_RATING;
    const b = DEFAULT_RATING;
    const { winner, loser } = recordDuel(a, b);
    expect(winner.r).toBeGreaterThan(a.r);
    expect(loser.r).toBeLessThan(b.r);
  });

  it('shrinks RD after a duel between fresh players', () => {
    const { winner, loser } = recordDuel(DEFAULT_RATING, DEFAULT_RATING);
    expect(winner.rd).toBeLessThan(DEFAULT_RATING.rd);
    expect(loser.rd).toBeLessThan(DEFAULT_RATING.rd);
  });

  it('upset (low rating beating high rating) shifts ratings more than the expected case', () => {
    const strong: GlickoRating = { r: 1800, rd: 60, sigma: 0.06 };
    const weak: GlickoRating = { r: 1200, rd: 60, sigma: 0.06 };

    const expected = recordDuel(strong, weak);
    const upset = recordDuel(weak, strong);

    const expectedShift = Math.abs(expected.winner.r - strong.r);
    const upsetShift = Math.abs(upset.winner.r - weak.r);
    expect(upsetShift).toBeGreaterThan(expectedShift);
  });

  it('symmetric: same duel applied twice never crosses ratings', () => {
    let a: GlickoRating = { r: 1600, rd: 100, sigma: 0.06 };
    let b: GlickoRating = { r: 1400, rd: 100, sigma: 0.06 };
    // a vence várias vezes — deve só aumentar a distância
    for (let i = 0; i < 5; i++) {
      const r = recordDuel(a, b);
      a = r.winner;
      b = r.loser;
    }
    expect(a.r).toBeGreaterThan(b.r);
  });

  it('clampRD respects min/max bounds', () => {
    expect(clampRD(500)).toBe(350);
    expect(clampRD(10)).toBe(30);
    expect(clampRD(150)).toBe(150);
  });
});

describe('classifyVolatility', () => {
  it('default σ (0.06) is "média"', () => {
    expect(classifyVolatility(0.06)).toBe('média');
  });

  it('classifies low volatility', () => {
    expect(classifyVolatility(0.03)).toBe('baixa');
    expect(classifyVolatility(0.054)).toBe('baixa');
  });

  it('classifies medium volatility', () => {
    expect(classifyVolatility(0.055)).toBe('média');
    expect(classifyVolatility(0.07)).toBe('média');
    expect(classifyVolatility(0.0749)).toBe('média');
  });

  it('classifies high volatility', () => {
    expect(classifyVolatility(0.075)).toBe('alta');
    expect(classifyVolatility(0.12)).toBe('alta');
  });
});

describe('classifyConfidence', () => {
  it('default RD (350) is "baixa"', () => {
    expect(classifyConfidence(350)).toBe('baixa');
  });

  it('classifies high confidence (low RD)', () => {
    expect(classifyConfidence(30)).toBe('alta');
    expect(classifyConfidence(50)).toBe('alta');
    expect(classifyConfidence(80)).toBe('alta');
  });

  it('classifies medium confidence', () => {
    expect(classifyConfidence(81)).toBe('média');
    expect(classifyConfidence(150)).toBe('média');
    expect(classifyConfidence(200)).toBe('média');
  });

  it('classifies low confidence (high RD)', () => {
    expect(classifyConfidence(201)).toBe('baixa');
    expect(classifyConfidence(350)).toBe('baixa');
  });
});
