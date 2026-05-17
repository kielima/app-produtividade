import { describe, expect, it } from 'vitest';
import { DEFAULT_RATING, type GlickoRating } from './glicko2';
import {
  pickNextPair,
  recommendedDuelLimit,
  reorderByRating,
  summarizeChanges,
} from './duelPairing';

const fresh = (r: number, rd = 350): GlickoRating => ({
  r,
  rd,
  sigma: DEFAULT_RATING.sigma,
});

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('pickNextPair', () => {
  it('returns null when fewer than 2 candidates', () => {
    expect(pickNextPair({ candidateIds: [], ratings: {} })).toBeNull();
    expect(pickNextPair({ candidateIds: ['a'], ratings: {} })).toBeNull();
  });

  it('always returns 2 distinct ids from the candidate list', () => {
    const rng = seededRng(42);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const ratings: Record<string, GlickoRating> = {};
    for (const id of ids) ratings[id] = fresh(1500);
    for (let i = 0; i < 200; i++) {
      const pair = pickNextPair({ candidateIds: ids, ratings, rng });
      expect(pair).not.toBeNull();
      expect(pair![0]).not.toBe(pair![1]);
      expect(ids).toContain(pair![0]);
      expect(ids).toContain(pair![1]);
    }
  });

  it('favors close ratings over distant ones for the second pick', () => {
    const rng = seededRng(7);
    const ids = ['target', 'close', 'far'];
    const ratings: Record<string, GlickoRating> = {
      target: fresh(1500, 50),
      close: fresh(1520, 50),
      far: fresh(2200, 50),
    };
    // Força que o primeiro seja sempre "target" zerando RD dos outros.
    // (não dá pra zerar de verdade, mas com seed estável pegamos amostra)
    let closeWins = 0;
    let farWins = 0;
    for (let i = 0; i < 1000; i++) {
      const pair = pickNextPair({ candidateIds: ids, ratings, rng });
      if (!pair) continue;
      const other = pair[0] === 'target' ? pair[1] : pair[0] === 'close' ? 'target' : null;
      const opp = pair.find((id) => id !== pair[0])!;
      if (pair.includes('target')) {
        const x = pair[0] === 'target' ? pair[1] : pair[0];
        if (x === 'close') closeWins++;
        if (x === 'far') farWins++;
      }
      void other;
      void opp;
    }
    expect(closeWins).toBeGreaterThan(farWins);
  });
});

describe('reorderByRating', () => {
  it('orders active projects by rating desc and appends inactive at the end', () => {
    const ratings: Record<string, GlickoRating> = {
      a: fresh(1600),
      b: fresh(1400),
      c: fresh(1700),
      d: fresh(1500),
    };
    const all = ['a', 'b', 'c', 'd'];
    const active = new Set(['a', 'b', 'c']);
    const result = reorderByRating(all, active, ratings);
    expect(result).toEqual(['c', 'a', 'b', 'd']);
  });

  it('preserves relative order of inactive ids', () => {
    const ratings: Record<string, GlickoRating> = { a: fresh(1500) };
    const all = ['x', 'y', 'a', 'z'];
    const active = new Set(['a']);
    expect(reorderByRating(all, active, ratings)).toEqual(['a', 'x', 'y', 'z']);
  });

  it('treats missing ratings as default', () => {
    const all = ['a', 'b'];
    const active = new Set(all);
    // Sem ratings persistidos: a e b ficam com rating default; ordem estável.
    expect(reorderByRating(all, active, {})).toHaveLength(2);
  });
});

describe('recommendedDuelLimit', () => {
  it('returns at least 10', () => {
    expect(recommendedDuelLimit(0)).toBe(10);
    expect(recommendedDuelLimit(3)).toBe(10);
    expect(recommendedDuelLimit(5)).toBe(10);
  });

  it('scales as N × 2', () => {
    expect(recommendedDuelLimit(8)).toBe(16);
    expect(recommendedDuelLimit(10)).toBe(20);
    expect(recommendedDuelLimit(12)).toBe(24);
  });

  it('caps at 25', () => {
    expect(recommendedDuelLimit(13)).toBe(25);
    expect(recommendedDuelLimit(50)).toBe(25);
  });
});

describe('summarizeChanges', () => {
  it('detects risers and fallers correctly', () => {
    const initial = ['a', 'b', 'c', 'd', 'e'];
    const final = ['c', 'a', 'e', 'b', 'd'];
    const s = summarizeChanges(initial, final);
    // a: 0→1 (delta -1) faller
    // b: 1→3 (delta -2) faller
    // c: 2→0 (delta +2) riser
    // d: 3→4 (delta -1) faller
    // e: 4→2 (delta +2) riser
    expect(s.risers.map((r) => r.id)).toEqual(['c', 'e']);
    expect(s.risers[0]!.delta).toBe(2);
    expect(s.fallers[0]!.id).toBe('b');
    expect(s.fallers[0]!.delta).toBe(-2);
  });

  it('returns the new top 3', () => {
    const s = summarizeChanges(['a', 'b', 'c', 'd'], ['c', 'd', 'a', 'b']);
    expect(s.newTop).toEqual(['c', 'd', 'a']);
  });

  it('limits to 3 risers and 3 fallers', () => {
    const initial = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const final = ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
    const s = summarizeChanges(initial, final);
    expect(s.risers).toHaveLength(3);
    expect(s.fallers).toHaveLength(3);
  });

  it('returns empty arrays when nothing moved', () => {
    const order = ['a', 'b', 'c'];
    const s = summarizeChanges(order, order);
    expect(s.risers).toEqual([]);
    expect(s.fallers).toEqual([]);
    expect(s.newTop).toEqual(['a', 'b', 'c']);
  });

  it('ignores ids that disappear or appear', () => {
    const s = summarizeChanges(['a', 'b', 'c'], ['a', 'b']);
    // c sumiu — não entra
    expect([...s.risers, ...s.fallers].map((d) => d.id)).not.toContain('c');
  });
});
