import { useEffect, useRef } from 'react';
import { pdfjsLib, type PDFPageProxy } from '../lib/pdf';
import type { Annotation, NormRect } from '../types';
import {
  distanceToStroke,
  inkStrokeBounds,
  inkStrokeToSvgPath,
  pointInRect,
} from '../lib/ink';
import { isSpenButtonPressed } from '../lib/spen';

export type ReaderTool = 'highlight' | 'comment' | 'eraser';

// Distância (normalizada) dentro da qual a borracha considera ter tocado algo.
const ERASER_HIT = 0.012;
// Movimento mínimo (px) para um gesto da caneta deixar de ser "toque" e virar arrasto.
const DRAG_THRESHOLD = 6;
// Raio (normalizado) para um toque "acertar" o pin de um comentário.
const COMMENT_HIT = 0.03;
// Folga (normalizada) para "acertar" um realce ao tocar — o realce é fino, então
// damos uma margem generosa para o toque abrir o comentário com facilidade.
const HL_TAP_PAD = 0.012;
// Distância máxima (px) entre apertar e soltar para o gesto contar como TOQUE
// (e não arrasto/rolagem). Tolerante a pequenas tremidas do dedo.
const TAP_MAX = 12;
// Tempo sem eventos de caneta após o qual devolvemos a rolagem normal ao dedo.
const PEN_IDLE_MS = 700;

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
  pen: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  // Ponto atual da caneta. A seleção do marca-texto é computada como seleção
  // de TEXTO (ordem de leitura) entre (startX,startY) e (curX,curY) — não como
  // faixa retangular.
  curX: number;
  curY: number;
};

function freshGesture(): Gesture {
  return {
    mode: 'idle',
    action: 'highlight',
    pen: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    curX: 0,
    curY: 0,
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
      // Higiene de render: um render CANCELADO (troca de zoom/escala) deixa os
      // spans já emitidos para trás, e chunks atrasados ainda podem pousar
      // depois do próximo replaceChildren. O diagnóstico no aparelho mostrou a
      // camada de texto com spans duplicados (título ×5) e mistos de renders
      // antigos — geometria fantasma que bagunçava a seleção do marca-texto.
      textLayerDiv.replaceChildren();
    };
  }, [page, scale]);

  // ----------------------------------------------------------------
  // Borracha 100% nativa (APK): o MainActivity manda 'spen-erase' com as
  // coordenadas (px CSS na janela) enquanto o botão da S-Pen está pressionado
  // com a caneta na tela. Apagamos por aqui SEM depender dos Pointer Events —
  // que em alguns WebViews são cancelados quando o botão do stylus está
  // pressionado (a ponte do botão chegava, mas o traço morria antes de apagar).
  // ----------------------------------------------------------------
  useEffect(() => {
    function onSpenErase(e: Event) {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      const container = containerRef.current;
      if (!container) return;
      const r = container.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      eraseAt({ x: (x - r.left) / r.width, y: (y - r.top) / r.height });
    }
    window.addEventListener('spen-erase', onSpenErase);
    return () => window.removeEventListener('spen-erase', onSpenErase);
  });

  // ----------------------------------------------------------------
  // Detecção da caneta (técnica do app de apresentações / laser)
  // ----------------------------------------------------------------
  // A S-Pen (e o Apple Pencil) são reconhecidos diretamente por
  // pointerType === 'pen'. O dedo nunca é interceptado: rola a página
  // normalmente. O segredo para o arrasto da caneta não virar rolagem no
  // Android/Samsung é DESARMAR os gestos do navegador ANTES do contato — a
  // S-Pen reporta "hover" antes de encostar, então armamos touch-action: none
  // no hover e capturamos o ponteiro no toque.
  const gesture = useRef<Gesture>(freshGesture());
  const penIdleTimer = useRef<number | null>(null);

  function isPen(e: React.PointerEvent): boolean {
    return e.pointerType === 'pen' || e.pointerType === 'mouse';
  }

  // Botão lateral da S-Pen: vira borracha, como no Samsung Notes.
  //  - Na versão APK (Capacitor), o botão vem da ponte nativa (isSpenButtonPressed).
  //  - No navegador, tentamos os bits de botão do PointerEvent (nem sempre
  //    expostos pelo Android, daí a versão APK).
  function isPenEraser(e: React.PointerEvent): boolean {
    return (
      isSpenButtonPressed() ||
      (e.buttons & 2) !== 0 ||
      (e.buttons & 32) !== 0 ||
      e.button === 5
    );
  }

  function armPen() {
    overlayRef.current?.style.setProperty('touch-action', 'none');
    if (penIdleTimer.current) clearTimeout(penIdleTimer.current);
    penIdleTimer.current = window.setTimeout(disarmPen, PEN_IDLE_MS);
  }
  function disarmPen() {
    if (gesture.current.mode === 'active') return; // nunca no meio de um traço
    overlayRef.current?.style.setProperty('touch-action', 'pan-y');
    penIdleTimer.current = null;
  }

  function localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function coalesced(e: React.PointerEvent): PointerEvent[] {
    return typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : [e.nativeEvent];
  }

  // Após um TOQUE que abre um diálogo (comentário), o navegador ainda dispara um
  // `click` sintético nas mesmas coordenadas. Como o diálogo abre um backdrop
  // que fecha no clique, esse click fechava o diálogo na hora (só "funcionava"
  // com toque longo, que não gera click). Engolimos o próximo click.
  function suppressNextClick() {
    const handler = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
      window.removeEventListener('click', handler, true);
    };
    window.addEventListener('click', handler, true);
    window.setTimeout(() => window.removeEventListener('click', handler, true), 700);
  }

  // ----------------------------------------------------------------
  // Marca-texto preciso "passando a caneta"
  // ----------------------------------------------------------------
  const spanBoxes = useRef<SpanBox[]>([]);

  // NOTA (saga do desalinhamento): as caixas de texto saíam ~14% mais largas
  // que os glifos do canvas no APK. Causa raiz: o WebView do Android segue a
  // escala de fonte de acessibilidade do sistema (textZoom = fontScale×100),
  // inflando o texto do DOM sem tocar no canvas — pdf.js issues #12243/#14426
  // (o contorno interno do pdf.js cobre só o "minimum font size" estrito).
  // Corrigido NA ORIGEM com setTextZoom(100) + setMinimumFontSize(1) no
  // MainActivity. Uma tentativa de reescalar os spans aqui no JS
  // (fitTextLayerWidths) foi removida: sobrescrever o transform do pdf.js
  // quebrava o truque de escala do minimum font size (alturas 9× maiores).
  // effRight + recorte por vizinho ficam como redes de segurança.

  function snapshotSpans() {
    const textLayer = textLayerRef.current;
    spanBoxes.current = [];
    segCache.current.clear();
    effRightCache.current.clear();
    if (!textLayer) return;
    for (const el of Array.from(textLayer.children)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      spanBoxes.current.push({ el, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }

  // Segmentos de GLIFOS VISÍVEIS de cada span (cache por gesto). Em alguns
  // PDFs, um span da coluna direita começa com espaços que ocupam a largura da
  // coluna esquerda: a CAIXA do span começa numa coluna e o texto visível está
  // na outra — qualquer filtro baseado na caixa deixa passar. Os segmentos
  // (sequências de caracteres não-brancos, quebradas em vãos grandes como o
  // corredor entre colunas) dizem onde existe texto DE VERDADE.
  const segCache = useRef<Map<number, Array<{ l: number; r: number }>>>(new Map());

  function spanSegments(i: number): Array<{ l: number; r: number }> {
    const cached = segCache.current.get(i);
    if (cached) return cached;
    const b = spanBoxes.current[i];
    const chars = charBoxes(b.el);
    const segs: Array<{ l: number; r: number }> = [];
    const gap = Math.max(8, (b.bottom - b.top) * 1.2);
    for (const ch of chars) {
      if (!ch.ch.trim() || ch.r - ch.l <= 0) continue;
      const last = segs[segs.length - 1];
      if (last && ch.l - last.r <= gap) last.r = Math.max(last.r, ch.r);
      else segs.push({ l: ch.l, r: ch.r });
    }
    const out = segs.length ? segs : [{ l: b.left, r: b.right }];
    segCache.current.set(i, out);
    return out;
  }

  // Borda direita EFETIVA de um span: a reportada pela caixa, recortada no
  // primeiro glifo do vizinho de OUTRA coluna que cruza a mesma linha. Nos
  // aparelhos reais as caixas saem mais LARGAS que os glifos desenhados
  // (dump: linha cheia da coluna esquerda com borda direita em 497 e a coluna
  // vizinha começando em 484), então a caixa inflada invade o começo da
  // coluna do lado. Sem esse recorte, um toque no INÍCIO da coluna direita
  // cai dentro da caixa da esquerda, o caret empata entre as duas e ancora na
  // coluna errada (dump real: gesto em "For inventory" marcou a esquerda).
  // Cache por gesto, como segCache.
  const effRightCache = useRef<Map<number, number>>(new Map());

  function effRight(i: number): number {
    const cached = effRightCache.current.get(i);
    if (cached !== undefined) return cached;
    const boxes = spanBoxes.current;
    const b = boxes[i];
    let right = b.right;
    const tol = Math.max(48, 0.12 * (b.right - b.left));
    for (let j = 0; j < boxes.length; j++) {
      if (j === i) continue;
      const nb = boxes[j];
      if (nb.top >= b.bottom || nb.bottom <= b.top) continue; // outra linha
      if (Math.abs(nb.left - b.left) <= tol) continue; // mesma coluna
      if (!(nb.el.textContent ?? '').trim()) continue; // só espaços não recorta
      const nl = spanSegments(j)[0].l;
      if (nl > b.left + 4 && nl < right) right = nl - 2;
    }
    if (right < b.left + 2) right = b.left + 2;
    effRightCache.current.set(i, right);
    return right;
  }

  function segmentNear(i: number, x: number): { l: number; r: number } {
    const segs = spanSegments(i);
    let best = segs[0];
    let bestD = Infinity;
    for (const sg of segs) {
      const d = x < sg.l ? sg.l - x : x > sg.r ? x - sg.r : 0;
      if (d < bestD) {
        bestD = d;
        best = sg;
      }
    }
    return best;
  }

  // "Caret" mais próximo de um ponto: pontua cada span pela distância
  // horizontal (dx) + vertical (dy, com peso alto: mesma linha ganha) e, se
  // houver um span de referência (a âncora da seleção), penaliza spans que NÃO
  // compartilham a faixa horizontal dele (outra coluna).
  //
  // A penalidade de coluna existe porque as linhas das duas colunas têm
  // alturas desalinhadas: ao terminar o traço num vão entre linhas da coluna
  // da âncora, esse vão pode coincidir com a faixa vertical de uma linha da
  // OUTRA coluna — sem a penalidade, o caret do foco pulava de coluna e a
  // seleção "abraçava" as duas colunas (fragmentos alheios no realce, visto no
  // aparelho). Só um arrasto bem para dentro da outra coluna supera a
  // penalidade (seleção entre colunas de propósito continua possível).
  function locateCaret(
    x: number,
    y: number,
    ref?: SpanBox,
  ): { index: number; x: number } | null {
    const boxes = spanBoxes.current;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      // Borda direita EFETIVA: a caixa inflada da coluna vizinha não pode
      // "conter" um toque dado no começo desta coluna (ver effRight).
      const bR = effRight(i);
      const dx = x < b.left ? b.left - x : x > bR ? x - bR : 0;
      const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
      // Mesma coluna = bordas ESQUERDAS próximas (colunas são alinhadas à
      // esquerda; tolerância cobre o recuo de parágrafo). O diagnóstico real
      // do aparelho mostrou que as CAIXAS dos spans podem se sobrepor entre
      // colunas (caixa ~15% mais larga que os glifos visíveis), o que
      // enganava o teste anterior por interseção de caixas.
      const sameCol =
        !ref ||
        Math.abs(b.left - ref.left) <= Math.max(48, 0.12 * (ref.right - ref.left));
      const score = dx + dy * 4 + (sameCol ? 0 : 160);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best === -1) return null;
    const b = boxes[best];
    return { index: best, x: Math.min(Math.max(x, b.left), effRight(best)) };
  }

  // Seleção em ORDEM DE LEITURA entre o início e o ponto atual do gesto (como
  // seleção de texto): linha da âncora do X inicial até o fim, linhas do meio
  // inteiras, linha do foco do começo até o X atual.
  //
  // IMPORTANTE: a seleção é 100% GEOMÉTRICA — linhas pela posição vertical e
  // coluna pela faixa horizontal — e NÃO usa a ordem interna dos trechos do
  // PDF. Motivo: em muitos arquivos (sobretudo de duas colunas) essa ordem
  // intercala as colunas de formas imprevisíveis, e qualquer seleção "por
  // índice" arrasta pedaços da outra coluna para o realce (bug visto no
  // aparelho mesmo com filtro de coluna sobre o intervalo de índices).
  function selectionClamps(): Array<{ index: number; left: number; right: number }> {
    const g = gesture.current;
    const boxes = spanBoxes.current;
    if (!boxes.length) return [];
    const a = locateCaret(g.startX, g.startY);
    if (!a) return [];
    // O foco é enviesado para a coluna da âncora (ver locateCaret).
    const f = locateCaret(g.curX, g.curY, boxes[a.index]);
    if (!f) return [];
    const aB = boxes[a.index];
    const fB = boxes[f.index];
    const aMid = (aB.top + aB.bottom) / 2;
    const fMid = (fB.top + fB.bottom) / 2;
    // Mesma linha = faixas verticais se sobrepõem no centro uma da outra.
    const sameRow = aMid <= fB.bottom && fMid <= aB.bottom && aMid >= fB.top && fMid >= aB.top;
    // Âncora antes do foco (linha acima, ou mesma linha e X menor).
    let s = a, sB = aB, e = f, eB = fB;
    if (sameRow ? f.x < a.x : fMid < aMid) {
      s = f; sB = fB; e = a; eB = aB;
    }
    const sMid = (sB.top + sB.bottom) / 2;
    const eMid = (eB.top + eB.bottom) / 2;
    // Coluna da seleção: faixa horizontal dos SEGMENTOS de glifos da âncora e
    // do foco (não das caixas — ver spanSegments), com os X de recorte
    // grampeados dentro deles.
    const sSeg = segmentNear(s.index, s.x);
    const eSeg = segmentNear(e.index, e.x);
    const sx = Math.min(Math.max(s.x, sSeg.l), sSeg.r);
    const ex = Math.min(Math.max(e.x, eSeg.l), eSeg.r);
    const colLeft = Math.min(sSeg.l, eSeg.l);
    const colRight = Math.max(sSeg.r, eSeg.r);

    const picked: Array<{ index: number; left: number; right: number; cy: number }> = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const cy = (b.top + b.bottom) / 2;
      const onStart = cy >= sB.top && cy <= sB.bottom; // linha da âncora
      const onEnd = cy >= eB.top && cy <= eB.bottom; // linha do foco
      if (!onStart && !onEnd && (cy <= sMid || cy >= eMid)) continue; // fora do intervalo
      // Testes horizontais POR SEGMENTO de glifos: imune a spans com espaços
      // enormes internos ou caixas que atravessam o corredor entre colunas.
      // Segmento que COMEÇA na beirada final da banda não é continuação de
      // linha da coluna — é conteúdo da coluna vizinha (dump real: células
      // estreitas de tabela da coluna direita, começando ~93% adentro da
      // banda, com centro ainda dentro dela). Fragmentos legítimos de linha
      // (ex.: subscrito do CO2 e o resto da linha após ele) começam no meio.
      const nearEdge = colRight - Math.max(40, 0.12 * (colRight - colLeft));
      for (const sg of spanSegments(i)) {
        const cx = (sg.l + sg.r) / 2;
        if (cx < colLeft - 2 || cx > colRight + 2) continue; // fora da coluna
        // Vale para TODAS as linhas (células de tabela podem encavalar
        // verticalmente com a linha da âncora/foco); só os spans da âncora e
        // do foco em si ficam isentos.
        if (i !== s.index && i !== e.index && sg.l > nearEdge) continue;
        if (onStart && sg.r <= sx) continue; // antes do início, mesma linha
        if (onEnd && sg.l >= ex) continue; // depois do fim, mesma linha
        const left = onStart ? Math.max(sg.l, sx) : sg.l;
        const right = onEnd ? Math.min(sg.r, ex) : sg.r;
        if (right - left < 1) continue;
        picked.push({ index: i, left, right, cy });
      }
    }
    // Ordena em ordem de leitura (linha de cima para baixo; na linha, esquerda
    // para direita) — vale para o texto extraído da citação.
    picked.sort((p, q) => {
      const bp = boxes[p.index];
      const bq = boxes[q.index];
      const rowTol = Math.min(bp.bottom - bp.top, bq.bottom - bq.top) * 0.6;
      if (Math.abs(p.cy - q.cy) > rowTol) return p.cy - q.cy;
      return p.left - q.left;
    });
    return picked.map(({ index, left, right }) => ({ index, left, right }));
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

  // Recorte VISUAL dos retângulos do realce. No aparelho real as caixas e
  // segmentos de texto saem mais LARGOS que os glifos desenhados no canvas
  // (dump real, página 2: linhas cheias da coluna esquerda com borda direita
  // em 493–497 enquanto as células da coluna vizinha começam em 465), então o
  // retângulo de uma linha inteira invade as primeiras letras da coluna do
  // lado, mesmo com a ESCOLHA dos trechos correta. A borda ESQUERDA dos spans
  // é confiável (vem da posição absoluta do PDF, não da largura da fonte);
  // recortamos a direita de cada retângulo na borda esquerda do primeiro
  // vizinho de OUTRA coluna que cruza a mesma linha. Afeta só o DESENHO — o
  // texto da citação continua usando o intervalo original, senão os últimos
  // caracteres da linha (com caixas igualmente inchadas) cairiam fora.
  function clipRectsToNeighbors(
    picked: Array<{ index: number; left: number; right: number }>,
  ): Array<{ index: number; left: number; right: number }> {
    return picked.map((p) => ({
      index: p.index,
      left: p.left,
      right: Math.min(p.right, effRight(p.index)),
    }));
  }

  // Retângulos do realce (0–1) a partir da seleção em ordem de leitura.
  function clampedHighlightRects(): NormRect[] {
    const container = containerRef.current;
    if (!container) return [];
    const c = container.getBoundingClientRect();
    const rects: NormRect[] = [];
    for (const { index, left, right } of clipRectsToNeighbors(selectionClamps())) {
      if (right - left < 1) continue; // esvaziado pelo recorte
      const s = spanBoxes.current[index];
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

  // TEMPORÁRIO (diagnóstico no aparelho): guarda um retrato completo da última
  // marcação — pontos do gesto, TODOS os spans (caixa + segmentos + texto) e o
  // que foi selecionado. O botão 🔬 do leitor copia/compartilha esse JSON para
  // depurarmos com os dados REAIS do dispositivo. Remover quando estabilizar.
  function dumpSelectionDebug(picked: Array<{ index: number; left: number; right: number }>) {
    try {
      const g = gesture.current;
      (window as unknown as { __lastSelDebug?: unknown }).__lastSelDebug = {
        page: pageNumber,
        dpr: window.devicePixelRatio,
        start: { x: Math.round(g.startX), y: Math.round(g.startY) },
        cur: { x: Math.round(g.curX), y: Math.round(g.curY) },
        picked: picked.map((p) => ({
          i: p.index,
          l: Math.round(p.left),
          r: Math.round(p.right),
        })),
        spans: spanBoxes.current.map((b, i) => ({
          i,
          l: Math.round(b.left),
          r: Math.round(b.right),
          er: Math.round(effRight(i)),
          t: Math.round(b.top),
          b: Math.round(b.bottom),
          s: (b.el.textContent ?? '').slice(0, 16),
          seg: spanSegments(i).map((sg) => [Math.round(sg.l), Math.round(sg.r)]),
        })),
      };
    } catch {
      // diagnóstico nunca pode quebrar a marcação
    }
  }

  function finishHighlight() {
    const container = containerRef.current;
    if (!container) return;
    const c = container.getBoundingClientRect();
    const rects: NormRect[] = [];
    const parts: string[] = [];
    const picked = selectionClamps();
    dumpSelectionDebug(picked);
    // Desenho recortado no vizinho; texto da citação com o intervalo original.
    const clipped = clipRectsToNeighbors(picked);
    for (let k = 0; k < picked.length; k++) {
      const { index, left, right } = picked[k];
      const s = spanBoxes.current[index];
      if (clipped[k].right - clipped[k].left >= 1) {
        rects.push({
          x: (clipped[k].left - c.left) / c.width,
          y: (s.top - c.top) / c.height,
          w: (clipped[k].right - clipped[k].left) / c.width,
          h: (s.bottom - s.top) / c.height,
        });
      }
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
  // Borracha e seleção por toque
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

  function annotationAt(pt: { x: number; y: number }): Annotation | null {
    for (const a of annotations) {
      if (a.type === 'highlight' && a.rects?.some((r) => pointInRect(r, pt.x, pt.y, HL_TAP_PAD))) {
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
  // Ponteiro
  // ----------------------------------------------------------------
  function onPointerDown(e: React.PointerEvent) {
    const action: Gesture['action'] =
      isPenEraser(e) || tool === 'eraser' ? 'erase' : tool === 'comment' ? 'comment' : 'highlight';

    if (isPen(e)) {
      armPen();
      e.preventDefault();
      overlayRef.current?.setPointerCapture?.(e.pointerId);
      gesture.current = {
        mode: 'pending',
        action,
        pen: true,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        curX: e.clientX,
        curY: e.clientY,
      };
      if (action === 'highlight') snapshotSpans();
      if (action === 'erase') eraseAt(localPoint(e));
      return;
    }

    // Dedo: só registramos para detectar um TOQUE. Sem capturar nem
    // preventDefault → a rolagem continua normal (touch-action: pan-y).
    gesture.current = {
      mode: 'pending',
      action,
      pen: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;

    // Caneta pairando (sem gesto em curso): mantém os gestos do navegador
    // desarmados para o próximo toque já nascer sem rolagem.
    if (isPen(e) && (g.mode === 'idle' || e.pointerId !== g.pointerId)) {
      armPen();
      return;
    }
    if (e.pointerId !== g.pointerId) return;

    if (g.mode === 'active') {
      e.preventDefault();
      // Botão da S-Pen no MEIO do traço: o aviso da ponte nativa chega
      // assíncrono (evaluateJavascript) e muitas vezes DEPOIS do gesto já ter
      // nascido como marca-texto — o diagnóstico no aparelho mostrou a ponte
      // funcionando (chamadas > 0) e a borracha mesmo assim inerte. Reavaliar
      // a cada movimento (como no Samsung Notes: apertou o botão, virou
      // borracha na hora), descartando o preview do realce em curso.
      if (g.action === 'highlight' && isPenEraser(e)) {
        g.action = 'erase';
        clearOverlay();
      }
      if (g.action === 'highlight') {
        g.curX = e.clientX;
        g.curY = e.clientY;
        previewHighlight();
      } else if (g.action === 'erase') {
        for (const ev of coalesced(e)) eraseAt(localPoint(ev));
      }
      return;
    }

    // pending
    // Dedo: não interceptamos — o navegador rola (pan-y) e dispara pointercancel
    // se virar rolagem; se for só um toque, o pointerup decide pela distância.
    if (!g.pen) return;
    const dx = Math.abs(e.clientX - g.startX);
    const dy = Math.abs(e.clientY - g.startY);
    if (Math.max(dx, dy) < DRAG_THRESHOLD) return;
    // Comentário não arrasta — fica pendente para virar toque ao soltar.
    if (g.action === 'comment') return;

    // Caneta arrastou → confirma marca-texto/borracha (em qualquer direção).
    // Reavalia o botão da S-Pen aqui também: alguns aparelhos só reportam o bit
    // do botão no primeiro movimento, não no toque inicial.
    if (isPenEraser(e)) g.action = 'erase';
    g.mode = 'active';
    armPen();
    e.preventDefault();
    if (g.action === 'highlight') {
      g.curX = e.clientX;
      g.curY = e.clientY;
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
      // Só conta como TOQUE se mal se moveu (senão foi rolagem/arrasto à toa).
      const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
      if (dist <= TAP_MAX) {
        const np = localPoint(e);
        if (g.action === 'erase') {
          eraseAt(np);
        } else {
          const hit = annotationAt(np);
          if (hit) {
            onSelectAnnotation(hit); // tocar um realce/pin abre o comentário
            suppressNextClick();
          } else if (g.action === 'comment') {
            onCreateComment(np);
            suppressNextClick();
          }
        }
      }
    }
    if (g.pen) {
      overlayRef.current?.releasePointerCapture?.(g.pointerId);
      armPen(); // reagenda o disarm
    }
    gesture.current = freshGesture();
    clearOverlay();
  }

  function onPointerCancel() {
    const g = gesture.current;
    if (g.pen) overlayRef.current?.releasePointerCapture?.(g.pointerId);
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

      {/* Camada de captura de ponteiro + pré-visualização do realce.
          Dedo: rola (pan-y). Caneta: ao pairar/encostar, armamos touch-action:
          none e capturamos, então o traço não vira rolagem em nenhuma direção. */}
      <canvas
        ref={overlayRef}
        className="pdf-ink-canvas"
        style={{
          pointerEvents: 'auto',
          touchAction: 'pan-y',
          cursor: tool === 'eraser' ? 'cell' : 'crosshair',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => disarmPen()}
        // Evita o menu de contexto que o botão da S-Pen / pressão longa dispara.
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
