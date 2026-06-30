import { useEffect, useRef } from 'react';
import { pdfjsLib, type PDFPageProxy } from '../lib/pdf';
import type { Annotation, InkPoint, InkStroke, NormRect } from '../types';
import {
  distanceToStroke,
  inkStrokeBounds,
  inkStrokeToSvgPath,
  pointInRect,
  strokeToSvgPath,
} from '../lib/ink';

export type ReaderTool = 'pan' | 'highlight' | 'comment' | 'pen' | 'eraser';

// Distância (normalizada) dentro da qual a borracha considera ter tocado um traço.
const ERASER_HIT = 0.012;

export function PdfPageView({
  page,
  pageNumber,
  scale,
  annotations,
  tool,
  color,
  penWidthFraction,
  onCreateHighlight,
  onCreateInk,
  onCreateComment,
  onSelectAnnotation,
  onEraseAnnotation,
}: {
  page: PDFPageProxy;
  pageNumber: number;
  scale: number;
  annotations: Annotation[];
  tool: ReaderTool;
  color: string;
  penWidthFraction: number;
  onCreateHighlight: (rects: NormRect[], text: string) => void;
  onCreateInk: (stroke: InkStroke) => void;
  onCreateComment: (anchor: { x: number; y: number }) => void;
  onSelectAnnotation: (a: Annotation) => void;
  onEraseAnnotation: (a: Annotation) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);

  // Dimensões em CSS px da página na escala atual (para denormalizar overlays).
  const sizeRef = useRef({ w: 0, h: 0 });

  // -------- Render da página (canvas + camada de texto) --------
  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    const inkCanvas = inkCanvasRef.current;
    if (!canvas || !textLayerDiv || !inkCanvas) return;

    let cancelled = false;
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    sizeRef.current = { w: viewport.width, h: viewport.height };

    for (const el of [canvas, inkCanvas]) {
      el.width = Math.floor(viewport.width * dpr);
      el.height = Math.floor(viewport.height * dpr);
      el.style.width = `${viewport.width}px`;
      el.style.height = `${viewport.height}px`;
    }
    const container = containerRef.current;
    if (container) {
      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
    }
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;
    // O pdf.js v4 posiciona e dimensiona cada span com calc(var(--scale-factor)*…px);
    // sem esta variável o texto renderiza gigante e sobreposto à página.
    textLayerDiv.style.setProperty('--scale-factor', String(scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const renderTask = page.render({ canvasContext: ctx, viewport });

    // Camada de texto (seleção para marca-texto).
    textLayerDiv.replaceChildren();
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayerDiv,
      viewport,
    });

    renderTask.promise
      .then(() => {
        if (cancelled) return;
        return textLayer.render();
      })
      .catch((err: unknown) => {
        if (
          err &&
          typeof err === 'object' &&
          'name' in err &&
          (err as { name: string }).name === 'RenderingCancelledException'
        ) {
          return;
        }
        console.debug('[reader] render falhou:', err);
      });

    return () => {
      cancelled = true;
      renderTask.cancel();
      textLayer.cancel();
    };
  }, [page, scale]);

  // -------- Marca-texto a partir da seleção de texto --------
  function handleSelectionEnd() {
    if (tool !== 'highlight') return;
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;

    const cRect = container.getBoundingClientRect();
    const rects: NormRect[] = [];
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      rects.push({
        x: (r.left - cRect.left) / cRect.width,
        y: (r.top - cRect.top) / cRect.height,
        w: r.width / cRect.width,
        h: r.height / cRect.height,
      });
    }
    if (rects.length === 0) return;
    onCreateHighlight(rects, sel.toString());
    sel.removeAllRanges();
  }

  // -------- Desenho de tinta (S-Pen) e borracha/comentário --------
  const drawing = useRef<{ active: boolean; points: Array<[number, number, number]> }>(
    { active: false, points: [] },
  );
  // Alguns aparelhos (vários Samsung) entregam a S-Pen como pointerType
  // 'touch', não 'pen'. Por isso não dá para simplesmente ignorar 'touch':
  // isso desligaria a caneta. Estratégia adaptativa: desenha com toque
  // normalmente; assim que o aparelho mostrar QUE sabe distinguir a caneta
  // (algum evento com pointerType 'pen'), passamos a tratar 'touch' como palma
  // e a ignorá-lo (palm rejection só onde é possível).
  const penSeen = useRef(false);

  function shouldDraw(e: React.PointerEvent): boolean {
    if (e.pointerType === 'pen') {
      penSeen.current = true;
      return true;
    }
    if (e.pointerType === 'mouse') return true;
    // touch: só ignora se este aparelho já provou saber reportar a caneta.
    return !penSeen.current;
  }

  function localPoint(e: React.PointerEvent): { x: number; y: number } {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function redrawCurrentInk() {
    const inkCanvas = inkCanvasRef.current;
    if (!inkCanvas) return;
    const ctx = inkCanvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
    const pts = drawing.current.points;
    if (pts.length === 0) return;
    const sizePx = Math.max(1, penWidthFraction * sizeRef.current.w);
    const path = strokeToSvgPath(pts, sizePx);
    ctx.fillStyle = color;
    ctx.fill(new Path2D(path));
  }

  function onCapturePointerDown(e: React.PointerEvent) {
    if (tool === 'comment') {
      onCreateComment(localPoint(e));
      return;
    }
    if (tool === 'eraser') {
      eraseAt(localPoint(e));
      return;
    }
    if (tool !== 'pen') return;
    if (!shouldDraw(e)) return; // palm rejection adaptativa
    // Evita que o gesto vire rolagem/zoom da página enquanto se desenha.
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = localPoint(e);
    drawing.current = {
      active: true,
      points: [[p.x * sizeRef.current.w, p.y * sizeRef.current.h, e.pressure || 0.5]],
    };
    redrawCurrentInk();
  }

  function onCapturePointerMove(e: React.PointerEvent) {
    if (tool === 'eraser' && e.buttons === 1) {
      eraseAt(localPoint(e));
      return;
    }
    if (tool !== 'pen' || !drawing.current.active) return;
    e.preventDefault();
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : [e.nativeEvent];
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    for (const ev of events) {
      const x = ((ev.clientX - rect.left) / rect.width) * sizeRef.current.w;
      const y = ((ev.clientY - rect.top) / rect.height) * sizeRef.current.h;
      drawing.current.points.push([x, y, ev.pressure || 0.5]);
    }
    redrawCurrentInk();
  }

  function onCapturePointerUp() {
    if (tool !== 'pen' || !drawing.current.active) return;
    const pts = drawing.current.points;
    drawing.current = { active: false, points: [] };
    const inkCanvas = inkCanvasRef.current;
    inkCanvas?.getContext('2d')?.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    if (pts.length < 2) return;
    const { w, h } = sizeRef.current;
    const points: InkPoint[] = pts.map(([x, y, p]) => ({ x: x / w, y: y / h, p }));
    onCreateInk({ points, width: penWidthFraction });
  }

  function eraseAt(pt: { x: number; y: number }) {
    for (const a of annotations) {
      if (a.type === 'ink' && a.strokes) {
        for (const s of a.strokes) {
          const b = inkStrokeBounds(s);
          if (!pointInRect(b, pt.x, pt.y, ERASER_HIT)) continue;
          if (distanceToStroke(s, pt.x, pt.y) <= ERASER_HIT) {
            onEraseAnnotation(a);
            return;
          }
        }
      } else if (a.rects) {
        if (a.rects.some((r) => pointInRect(r, pt.x, pt.y))) {
          onEraseAnnotation(a);
          return;
        }
      }
    }
  }

  const { w, h } = sizeRef.current;
  const captureActive = tool === 'pen' || tool === 'eraser' || tool === 'comment';

  return (
    <div
      ref={containerRef}
      className="pdf-page"
      data-page={pageNumber}
      onPointerUp={tool === 'highlight' ? handleSelectionEnd : undefined}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div
        ref={textLayerRef}
        className="pdf-text-layer"
        style={{ pointerEvents: tool === 'highlight' ? 'auto' : 'none' }}
      />

      {/* Overlay de anotações salvas (marca-texto + tinta + pins de comentário) */}
      <svg
        className="pdf-annotation-layer"
        viewBox={`0 0 ${w || 1} ${h || 1}`}
        width={w}
        height={h}
        style={{ pointerEvents: 'none' }}
      >
        {annotations.flatMap((a) => {
          if (a.type === 'ink' && a.strokes) {
            return a.strokes.map((s, i) => (
              <path
                key={`${a.id}-${i}`}
                d={inkStrokeToSvgPath(s, w, h)}
                fill={a.color}
                opacity={0.95}
              />
            ));
          }
          if (a.rects) {
            return a.rects.map((r, i) => (
              <rect
                key={`${a.id}-${i}`}
                x={r.x * w}
                y={r.y * h}
                width={r.w * w}
                height={r.h * h}
                fill={a.color}
                opacity={a.comment ? 0.45 : 0.32}
                style={{ pointerEvents: tool === 'pan' ? 'auto' : 'none', cursor: 'pointer' }}
                onClick={() => tool === 'pan' && onSelectAnnotation(a)}
              />
            ));
          }
          return [];
        })}
      </svg>

      {/* Pins de comentário (sempre clicáveis) */}
      {annotations
        .filter((a) => a.type === 'comment' && a.anchor)
        .map((a) => (
          <button
            key={a.id}
            type="button"
            className="pdf-comment-pin"
            style={{ left: `${a.anchor!.x * 100}%`, top: `${a.anchor!.y * 100}%` }}
            title={a.comment || 'Comentário'}
            onClick={() => onSelectAnnotation(a)}
            aria-label="Abrir comentário"
          >
            💬
          </button>
        ))}

      {/* Canvas de tinta ao vivo + camada de captura de ponteiro */}
      <canvas
        ref={inkCanvasRef}
        className="pdf-ink-canvas"
        style={{
          pointerEvents: captureActive ? 'auto' : 'none',
          // Desliga rolagem/zoom do navegador enquanto desenha ou apaga, para o
          // gesto da caneta não virar scroll.
          touchAction: tool === 'pen' || tool === 'eraser' ? 'none' : 'auto',
          cursor: tool === 'eraser' ? 'cell' : 'crosshair',
        }}
        onPointerDown={captureActive ? onCapturePointerDown : undefined}
        onPointerMove={captureActive ? onCapturePointerMove : undefined}
        onPointerUp={captureActive ? onCapturePointerUp : undefined}
        onPointerLeave={captureActive ? onCapturePointerUp : undefined}
      />
    </div>
  );
}
