import { describe, expect, it } from 'vitest';
import { buildProjectScoreMap } from './projectRankScore';

describe('buildProjectScoreMap', () => {
  it('returns empty map for empty input', () => {
    expect(buildProjectScoreMap([])).toEqual({});
  });

  it('assigns 3 to the sole project when N=1', () => {
    expect(buildProjectScoreMap([{ id: 'a' }])).toEqual({ a: 3 });
  });

  it('anchors extremes at 3 and 0 for N=2', () => {
    const m = buildProjectScoreMap([{ id: 'top' }, { id: 'bot' }]);
    expect(m.top).toBe(3);
    expect(m.bot).toBe(0);
  });

  it('puts middle at exactly 1.5 for N=3', () => {
    const m = buildProjectScoreMap([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(m.a).toBeCloseTo(3, 6);
    expect(m.b).toBeCloseTo(1.5, 6);
    expect(m.c).toBeCloseTo(0, 6);
  });

  it('keeps monotonic decrease for N=10', () => {
    const ids = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
    const m = buildProjectScoreMap(ids);
    const scores = ids.map((p) => m[p.id]!);
    expect(scores[0]).toBe(3);
    expect(scores[9]).toBe(0);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    }
  });

  it('clusters mid-rank scores around 1.5 (bell shape) for N=10', () => {
    const ids = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
    const m = buildProjectScoreMap(ids);
    // Os 4 do meio (índices 3..6) devem ficar entre ~0.8 e ~2.2
    for (let i = 3; i <= 6; i++) {
      const s = m[`p${i}`]!;
      expect(s).toBeGreaterThan(0.8);
      expect(s).toBeLessThan(2.2);
    }
  });
});
