import { getStroke } from 'perfect-freehand';
import type { InkPoint, InkStroke, NormRect } from '../types';

// Converte a saída do perfect-freehand (polígono que contorna o traço) num
// path SVG fechado.
function outlineToPath(points: number[][]): string {
  if (points.length === 0) return '';
  const d = points.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', points[0][0], points[0][1], 'Q'] as (string | number)[],
  );
  d.push('Z');
  return d.join(' ');
}

const STROKE_OPTIONS = {
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
};

// Gera o path SVG de um traço a partir de pontos em pixels [x, y, pressão].
export function strokeToSvgPath(
  pxPoints: Array<[number, number, number]>,
  sizePx: number,
): string {
  const outline = getStroke(pxPoints, { size: sizePx, ...STROKE_OPTIONS });
  return outlineToPath(outline as number[][]);
}

// Denormaliza um InkStroke (0–1) para um path SVG em pixels da página atual.
export function inkStrokeToSvgPath(
  stroke: InkStroke,
  pageWidthPx: number,
  pageHeightPx: number,
): string {
  const px = stroke.points.map(
    (p): [number, number, number] => [p.x * pageWidthPx, p.y * pageHeightPx, p.p],
  );
  const sizePx = Math.max(1, stroke.width * pageWidthPx);
  return strokeToSvgPath(px, sizePx);
}

// Caixa delimitadora normalizada de um traço — usada pela borracha para
// hit-testing barato antes de checar distância ponto a ponto.
export function inkStrokeBounds(stroke: InkStroke): NormRect {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of stroke.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Distância mínima (normalizada) de um ponto aos segmentos de um traço.
export function distanceToStroke(
  stroke: InkStroke,
  x: number,
  y: number,
): number {
  let min = Infinity;
  const pts = stroke.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    min = Math.min(min, pointSegmentDistance(x, y, a.x, a.y, b.x, b.y));
  }
  return min;
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointInRect(r: NormRect, x: number, y: number, pad = 0): boolean {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

export type { InkPoint };
