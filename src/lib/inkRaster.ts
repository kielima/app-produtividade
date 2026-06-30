import type { PDFDocumentProxy } from './pdf';
import type { Annotation } from '../types';
import { inkStrokeBounds, inkStrokeToSvgPath } from './ink';

// Rasteriza a região de um traço de tinta (com a própria tinta desenhada por
// cima) para uma imagem PNG base64 — entrada para o OCR (Gemini) ao converter
// uma anotação manuscrita em nota/tarefa.
export async function rasterizeInkRegion(
  doc: PDFDocumentProxy,
  annotation: Annotation,
): Promise<{ imageBase64: string; mimeType: string }> {
  if (!annotation.strokes || annotation.strokes.length === 0) {
    throw new Error('Anotação sem traços para converter.');
  }
  const page = await doc.getPage(annotation.page);
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const full = document.createElement('canvas');
  full.width = Math.floor(viewport.width);
  full.height = Math.floor(viewport.height);
  const ctx = full.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível.');
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Desenha os traços por cima, nas coordenadas em px desta escala.
  for (const s of annotation.strokes) {
    const path = inkStrokeToSvgPath(s, viewport.width, viewport.height);
    ctx.fillStyle = annotation.color;
    ctx.fill(new Path2D(path));
  }

  // Bounding box (normalizado) de todos os traços + padding.
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const s of annotation.strokes) {
    const b = inkStrokeBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const pad = 0.02;
  const cropX = Math.max(0, (minX - pad) * viewport.width);
  const cropY = Math.max(0, (minY - pad) * viewport.height);
  const cropW = Math.min(viewport.width, (maxX + pad) * viewport.width) - cropX;
  const cropH = Math.min(viewport.height, (maxY + pad) * viewport.height) - cropY;

  const crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.floor(cropW));
  crop.height = Math.max(1, Math.floor(cropH));
  const cropCtx = crop.getContext('2d');
  if (!cropCtx) throw new Error('Canvas indisponível.');
  cropCtx.drawImage(full, cropX, cropY, cropW, cropH, 0, 0, crop.width, crop.height);

  const dataUrl = crop.toDataURL('image/png');
  const imageBase64 = dataUrl.split(',')[1] ?? '';
  return { imageBase64, mimeType: 'image/png' };
}
