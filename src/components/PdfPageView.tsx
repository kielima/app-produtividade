import { useEffect, useRef } from 'react';
import { pdfjsLib, type PDFPageProxy } from '../lib/pdf';
import type { Annotation, NormRect } from '../types';
import {
  distanceToStroke,
  inkStrokeBounds,
  inkStrokeToSvgPath,
  pointInRect,
} from '../lib/ink';

export type ReaderTool = 'highlight' | 'comment' | 'eraser';

// Distância (normalizada) dentro da qual a borracha considera ter tocado algo.
const ERASER_HIT = 0.012;
// Acima deste tamanho de contato (px) tratamos o ponteiro como DEDO (rolagem),
// não caneta. A S-Pen reporta um ponto minúsculo; o dedo, uma área grande.
const PEN_MAX_CONTACT = 18;
// Movimento mínimo (px) para um gesto deixar de ser "toque" e virar arrasto.
const DRAG_THRESHOLD = 6;
// Raio (normalizado) para um toque "acertar" o pin de um comentário.
const COMMENT_HIT = 0.03;

type SpanBox = {
  el: Element;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Gesture = {
  mode: 'idle' | 'pending' | 'active';
  action: 'highlight' | 'erase' | 'comment';
  pointerId: number;
  startX: number;
  startY: number;
  penLike: boolean;
  minX: number;
  maxX: number;
  spans: Set<number>;
};

function freshGesture(): Gesture {
  return {
    mode: 'idle',
    action: 'highlight',
    pointerId: -1,
    startX: 0,
    startY: 0,
    penLike: false,
    minX: 0,
    maxX: 0,
    spans: new Set(),
  };
}

export function PdfPageView({
  page,
  pageNumber,
  scale,
  annotations,
  tool,
  color,
  onCreateHighlight,
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
  onCreateHighlight: (rects: NormRect[], text: string) => void;
  onCreateComment: (anchor: { x: number; y: number }) => void;
  onSelectAnnotation: (a: Annotation) => void;
  onEraseAnnotation: (a: Annotation) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Dimensões em CSS px da página na escala atual (para denormalizar overlays).
  const sizeRef = useRef({ w: 0, h: 0 });

  // -------- Render da página (canvas + camada de texto) --------
  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !textLayerDiv || !overlay) return;

    let cancelled = false;
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    sizeRef.current = { w: viewport.width, h: viewport.height };

    for (const el of [canvas, overlay]) {
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

  // ----------------------------------------------------------------
  // Detecção dedo × caneta e botão da S-Pen
  // ----------------------------------------------------------------
  // Muitos aparelhos (vários Samsung) entregam a S-Pen como pointerType 'touch'.
  // Distinguimos a caneta do dedo pelo TAMANHO do contato: a caneta é um ponto
  // (width/height minúsculos ou 0); o dedo é uma área grande.
  function isPenLike(e: React.PointerEvent): boolean {
    if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true;
    if (e.pointerType === 'touch') {
      const size = Math.max(e.width || 0, e.height || 0);
      return size === 0 || size <= PEN_MAX_CONTACT;
    }
    return false;
  }

  // Botão lateral da S-Pen (bit 2) ou ponta-borracha (bit 32): vira borracha,
  // como no Samsung Notes. Só funciona quando o aparelho reporta a caneta como
  // 'pen' (alguns reportam como 'touch' e aí o botão não chega ao navegador).
  function isPenEraser(e: React.PointerEvent): boolean {
    return (
      e.pointerType === 'pen' &&
      ((e.buttons & 2) !== 0 || (e.buttons & 32) !== 0 || e.button === 5)
    );
  }

  function localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  // ----------------------------------------------------------------
  // Marca-texto preciso "passando a caneta"
  // ----------------------------------------------------------------
  // Snapshot da posição de cada span do texto no início do gesto.
  const spanBoxes = useRef<SpanBox[]>([]);
  const gesture = useRef<Gesture>(freshGesture());

  function snapshotSpans() {
    const textLayer = textLayerRef.current;
    spanBoxes.current = [];
    if (!textLayer) return;
    for (const el of Array.from(textLayer.children)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      spanBoxes.current.push({
        el,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
    }
  }

  function collectSpansAt(clientX: number, clientY: number) {
    const boxes = spanBoxes.current;
    const g = gesture.current;
    for (let i = 0; i < boxes.length; i++) {
      if (g.spans.has(i)) continue;
      const s = boxes[i];
      if (clientX >= s.left && clientX <= s.right && clientY >= s.top && clientY <= s.bottom) {
        g.spans.add(i);
      }
    }
  }

  // Caixas (client coords) de cada caractere de um span, para realce com
  // precisão de letra/símbolo.
  function charBoxes(el: Element): Array<{ l: number; r: number; ch: string }> {
    const node = el.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return [];
    const text = node.textContent ?? '';
    const out: Array<{ l: number; r: number; ch: string }> = [];
    const range = document.createRange();
    for (let k = 0; k < text.length; k++) {
      range.setStart(node, k);
      range.setEnd(node, k + 1);
      const r = range.getBoundingClientRect();
      out.push({ l: r.left, r: r.right, ch: text[k] });
    }
    return out;
  }

  // Retângulos do realce, recortados horizontalmente ao trecho varrido
  // [minX, maxX]. Em coordenadas normalizadas (0–1).
  function clampedHighlightRects(): NormRect[] {
    const g = gesture.current;
    const container = containerRef.current;
    if (!container) return [];
    const c = container.getBoundingClientRect();
    const rects: NormRect[] = [];
    for (const i of g.spans) {
      const s = spanBoxes.current[i];
      const left = Math.max(s.left, g.minX);
      const right = Math.min(s.right, g.maxX);
      if (right - left < 1) continue;
      rects.push({
        x: (left - c.left) / c.width,
        y: (s.top - c.top) / c.height,
        w: (right - left) / c.width,
        h: (s.bottom - s.top) / c.height,
      });
    }
    return rects;
  }

  function previewHighlight() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    const { w, h } = sizeRef.current;
    for (const r of clampedHighlightRects()) {
      ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
    }
    ctx.globalAlpha = 1;
  }

  function clearOverlay() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
  }

  function finishHighlight() {
    const g = gesture.current;
    const container = containerRef.current;
    if (!container) return;
    const c = container.getBoundingClientRect();
    const indices = [...g.spans].sort((a, b) => a - b);
    const rects: NormRect[] = [];
    const parts: string[] = [];
    for (const i of indices) {
      const s = spanBoxes.current[i];
      const left = Math.max(s.left, g.minX);
      const right = Math.min(s.right, g.maxX);
      if (right - left < 1) continue;
      rects.push({
        x: (left - c.left) / c.width,
        y: (s.top - c.top) / c.height,
        w: (right - left) / c.width,
        h: (s.bottom - s.top) / c.height,
      });
      const chars = charBoxes(s.el);
      if (chars.length) {
        parts.push(
          chars
            .filter((ch) => ch.r > left && ch.l < right)
            .map((ch) => ch.ch)
            .join(''),
        );
      }
    }
    if (rects.length === 0) return;
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    onCreateHighlight(rects, text);
  }

  // ----------------------------------------------------------------
  // Borracha
  // ----------------------------------------------------------------
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
      } else if (a.type === 'comment' && a.anchor) {
        if (Math.hypot(a.anchor.x - pt.x, a.anchor.y - pt.y) < COMMENT_HIT) {
          onEraseAnnotation(a);
          return;
        }
      } else if (a.rects) {
        if (a.rects.some((r) => pointInRect(r, pt.x, pt.y))) {
          onEraseAnnotation(a);
          return;
        }
      }
    }
  }

  // Anotação sob um toque (para abrir comentário ao tocar um realce/pin).
  function annotationAt(pt: { x: number; y: number }): Annotation | null {
    for (const a of annotations) {
      if (a.type === 'highlight' && a.rects?.some((r) => pointInRect(r, pt.x, pt.y))) {
        return a;
      }
    }
    for (const a of annotations) {
      if (
        a.type === 'comment' &&
        a.anchor &&
        Math.hypot(a.anchor.x - pt.x, a.anchor.y - pt.y) < COMMENT_HIT
      ) {
        return a;
      }
    }
    return null;
  }

  // ----------------------------------------------------------------
  // Pipeline de ponteiro (decisão diferida: rolar × marcar × apagar)
  // ----------------------------------------------------------------
  function coalesced(e: React.PointerEvent): PointerEvent[] {
    return typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : [e.nativeEvent];
  }

  function onPointerDown(e: React.PointerEvent) {
    const action: Gesture['action'] =
      isPenEraser(e) || tool === 'eraser'
        ? 'erase'
        : tool === 'comment'
          ? 'comment'
          : 'highlight';
    gesture.current = {
      mode: 'pending',
      action,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      penLike: isPenLike(e),
      minX: e.clientX,
      maxX: e.clientX,
      spans: new Set(),
    };
    if (action === 'highlight') snapshotSpans();
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (g.mode === 'idle' || e.pointerId !== g.pointerId) return;

    if (g.mode === 'active') {
      e.preventDefault();
      if (g.action === 'highlight') {
        for (const ev of coalesced(e)) {
          g.minX = Math.min(g.minX, ev.clientX);
          g.maxX = Math.max(g.maxX, ev.clientX);
          collectSpansAt(ev.clientX, ev.clientY);
        }
        previewHighlight();
      } else if (g.action === 'erase') {
        for (const ev of coalesced(e)) eraseAt(localPoint(ev));
      }
      return;
    }

    // pending → decide a intenção quando houver movimento suficiente
    const dx = Math.abs(e.clientX - g.startX);
    const dy = Math.abs(e.clientY - g.startY);
    if (Math.max(dx, dy) < DRAG_THRESHOLD) return;

    // Arrasto vertical = rolagem (touch-action: pan-y cuida disso). Abandona.
    if (dy > dx) {
      g.mode = 'idle';
      return;
    }
    // Comentário não arrasta; arrasto horizontal aqui também vira rolagem.
    if (g.action === 'comment') {
      g.mode = 'idle';
      return;
    }
    // Marca-texto só com caneta (dedo horizontal é ignorado para não marcar sem
    // querer). Borracha aceita qualquer ponteiro.
    if (g.action === 'highlight' && !g.penLike) {
      g.mode = 'idle';
      return;
    }

    // Confirma o arrasto: a partir daqui capturamos e impedimos a rolagem.
    g.mode = 'active';
    (e.target as Element).setPointerCapture?.(g.pointerId);
    e.preventDefault();
    if (g.action === 'highlight') {
      g.minX = Math.min(g.startX, e.clientX);
      g.maxX = Math.max(g.startX, e.clientX);
      collectSpansAt(g.startX, g.startY);
      for (const ev of coalesced(e)) collectSpansAt(ev.clientX, ev.clientY);
      previewHighlight();
    } else if (g.action === 'erase') {
      eraseAt(localPoint({ clientX: g.startX, clientY: g.startY }));
      eraseAt(localPoint(e));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    if (e.pointerId !== g.pointerId) return;

    if (g.mode === 'active') {
      if (g.action === 'highlight') finishHighlight();
      // borracha já apagou ao longo do arrasto
    } else if (g.mode === 'pending') {
      // Toque (sem arrasto)
      const np = localPoint(e);
      if (g.action === 'erase') {
        eraseAt(np);
      } else {
        const hit = annotationAt(np);
        if (hit) {
          onSelectAnnotation(hit); // tocar um realce/pin abre o comentário
        } else if (g.action === 'comment') {
          onCreateComment(np);
        }
      }
    }
    gesture.current = freshGesture();
    clearOverlay();
  }

  function onPointerCancel() {
    gesture.current = freshGesture();
    clearOverlay();
  }

  const { w, h } = sizeRef.current;

  return (
    <div ref={containerRef} className="pdf-page" data-page={pageNumber}>
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerRef} className="pdf-text-layer" style={{ pointerEvents: 'none' }} />

      {/* Overlay de anotações salvas (marca-texto + tinta) */}
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
              <path key={`${a.id}-${i}`} d={inkStrokeToSvgPath(s, w, h)} fill={a.color} opacity={0.95} />
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
                opacity={a.comment ? 0.5 : 0.32}
              />
            ));
          }
          return [];
        })}
      </svg>

      {/* Pins de comentário (apenas visuais; o toque é tratado pela camada de captura) */}
      {annotations
        .filter((a) => a.type === 'comment' && a.anchor)
        .map((a) => (
          <span
            key={a.id}
            className="pdf-comment-pin"
            style={{ left: `${a.anchor!.x * 100}%`, top: `${a.anchor!.y * 100}%`, pointerEvents: 'none' }}
            title={a.comment || 'Comentário'}
            aria-hidden="true"
          >
            💬
          </span>
        ))}

      {/* Camada de captura de ponteiro + pré-visualização do realce */}
      <canvas
        ref={overlayRef}
        className="pdf-ink-canvas"
        style={{
          pointerEvents: 'auto',
          // pan-y: arrasto vertical rola a página; o resto (marcar/apagar
          // horizontal, tocar) é tratado por nós.
          touchAction: 'pan-y',
          cursor: tool === 'eraser' ? 'cell' : 'crosshair',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </div>
  );
}
