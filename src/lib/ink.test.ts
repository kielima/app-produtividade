import { describe, expect, it } from 'vitest';
import { distanceToStroke, inkStrokeBounds, pointInRect } from './ink';
import type { InkStroke } from '../types';

const stroke: InkStroke = {
  width: 0.004,
  points: [
    { x: 0.2, y: 0.3, p: 0.5 },
    { x: 0.6, y: 0.3, p: 0.5 },
    { x: 0.6, y: 0.5, p: 0.5 },
  ],
};

describe('inkStrokeBounds', () => {
  it('computes the normalized bounding box of a stroke', () => {
    const b = inkStrokeBounds(stroke);
    expect(b.x).toBeCloseTo(0.2, 6);
    expect(b.y).toBeCloseTo(0.3, 6);
    expect(b.w).toBeCloseTo(0.4, 6);
    expect(b.h).toBeCloseTo(0.2, 6);
  });
});

describe('pointInRect', () => {
  const r = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };
  it('detects points inside and outside', () => {
    expect(pointInRect(r, 0.4, 0.4)).toBe(true);
    expect(pointInRect(r, 0.1, 0.4)).toBe(false);
  });
  it('honors the padding argument', () => {
    expect(pointInRect(r, 0.19, 0.3, 0.02)).toBe(true);
    expect(pointInRect(r, 0.19, 0.3, 0)).toBe(false);
  });
});

describe('distanceToStroke', () => {
  it('is ~0 for a point on a segment', () => {
    expect(distanceToStroke(stroke, 0.4, 0.3)).toBeCloseTo(0, 6);
  });
  it('measures perpendicular distance from a segment', () => {
    // Ponto a 0.1 acima do segmento horizontal y=0.3.
    expect(distanceToStroke(stroke, 0.4, 0.2)).toBeCloseTo(0.1, 6);
  });
});
