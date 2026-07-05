import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPdfDocument, type PDFDocumentProxy, type PDFPageProxy } from '../lib/pdf';
import { fetchPdfBytes } from '../lib/readingDocs';
import { DriveAuthError, ensureDriveToken } from '../lib/googleDrive';
import { extractDoiFromText } from '../lib/readingMetadata';
import {
  newAnnotationId,
  subscribeToAnnotations,
  upsertAnnotation,
  deleteAnnotation,
} from '../repositories/annotationsRepo';
import { patchReadingItem, saveReadingMetadata } from '../repositories/readingItemsRepo';
import { PdfPageView, type ReaderTool } from '../components/PdfPageView';
import { MetadataEditor } from '../components/MetadataEditor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createNoteFromText, createTaskFromText, pickDefaultProjectId } from '../lib/createFromText';
import type { Annotation, NormRect, Project, ReadingItem } from '../types';

const HIGHLIGHT_COLORS = ['#ffd54a', '#a5d6a7', '#90caf9', '#f48fb1', '#ce93d8'];
const VIEW_MODE_KEY = 'app-produtividade:reader-view-mode';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }
  | { status: 'needs-drive'; message: string };

export function ReaderView({
  uid,
  item,
  projects,
  onClose,
  onConverted,
}: {
  uid: string;
  item: ReadingItem;
  projects: Project[];
  onClose: () => void;
  onConverted: (dest: 'note' | 'task', id: string) => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [baseAspect, setBaseAspect] = useState(1.414); // h/w; A4 retrato como palpite
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Padrão: marca-texto já ativo ao abrir o PDF — é só passar a caneta/dedo
  // sobre o texto para realçar (rolagem vertical continua funcionando).
  // Ferramenta fixa: a caneta marca por padrão; a borracha vem do botão da
  // S-Pen (ou de tocar numa marcação para editar/apagar). Sem botões de
  // ferramenta na barra — só as cores.
  const tool: ReaderTool = 'highlight';
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [zoom, setZoom] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  // Modo de visualização: rolagem vertical contínua (padrão) ou página a
  // página com virada horizontal estilo livro. Persistido entre sessões.
  const [viewMode, setViewMode] = useState<'scroll' | 'page'>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'page' ? 'page' : 'scroll';
    } catch {
      return 'scroll';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // sem storage — segue sem persistir
    }
  }, [viewMode]);

  // Barra superior auto-oculta: some ao rolar/virar página, volta ao rolar
  // para cima, tocar no centro da página (modo livro) ou voltar ao topo.
  const [barHidden, setBarHidden] = useState(false);
  const toolbarRef = useRef<HTMLElement | null>(null);

  // Página atual do modo livro (0-based); retoma de item.currentPage.
  const [pageIndex, setPageIndex] = useState(() =>
    Math.max(0, (item.currentPage ?? 1) - 1),
  );
  // Virada de página em curso (arrasto ou animação de conclusão).
  const [turn, setTurn] = useState<
    null | { dir: 'next' | 'prev'; progress: number; animating: boolean }
  >(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pagesWrapRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Editor de comentário: novo (com anchor) ou edição de uma anotação existente.
  const [commentTarget, setCommentTarget] = useState<
    | { mode: 'new'; anchor: { x: number; y: number }; page: number }
    | { mode: 'edit'; annotation: Annotation }
    | null
  >(null);
  const [commentText, setCommentText] = useState('');
  const [commentTitle, setCommentTitle] = useState('');

  // -------- Carregamento do PDF --------
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    (async () => {
      try {
        const bytes = await fetchPdfBytes(uid, item.driveFileId);
        if (cancelled) return;
        const doc = await loadPdfDocument(bytes);
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
        const page1 = await doc.getPage(1);
        const vp = page1.getViewport({ scale: 1 });
        setBaseAspect(vp.height / vp.width);
        setLoad({ status: 'ready' });
        // Marca como "lendo" e registra a abertura.
        void patchReadingItem(uid, item.id, {
          lastOpenedAt: new Date().toISOString(),
          ...(item.readingStatus === 'to-read' ? { readingStatus: 'reading' } : {}),
        });
        // Tenta autodetectar DOI se ainda não há metadados.
        if (!item.doi && item.authors.length === 0) {
          void autoDetectDoi(doc, uid, item);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DriveAuthError) {
          setLoad({ status: 'needs-drive', message: err.message });
        } else {
          setLoad({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, item.id, item.driveFileId]);

  // -------- Anotações em tempo real --------
  useEffect(() => {
    return subscribeToAnnotations(uid, item.id, setAnnotations);
  }, [uid, item.id]);

  // -------- Dimensões do container ativo (responsivo) --------
  useEffect(() => {
    const el = viewMode === 'page' ? bookRef.current : scrollRef.current;
    if (!el) return;
    const update = () => setAreaSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [load.status, viewMode]);

  const targetWidth = Math.min(Math.max(areaSize.w - 24, 280), 1000) * zoom;

  // Modo livro: página "contida" na área visível (largura E altura), depois
  // multiplicada pelo zoom da pinça.
  const fitPageWidth = useMemo(() => {
    const availW = Math.max(200, areaSize.w - 12);
    const availH = Math.max(200, areaSize.h - 12);
    return Math.min(availW, availH / baseAspect);
  }, [areaSize, baseAspect]);
  const bookPageWidth = fitPageWidth * zoom;

  // Clampa a página atual quando o total é conhecido; persiste pra retomar.
  useEffect(() => {
    if (numPages > 0) setPageIndex((i) => Math.min(i, numPages - 1));
  }, [numPages]);
  useEffect(() => {
    if (viewMode !== 'page' || numPages === 0) return;
    const t = setTimeout(() => {
      void patchReadingItem(uid, item.id, { currentPage: pageIndex + 1 });
    }, 800);
    return () => clearTimeout(t);
  }, [viewMode, pageIndex, numPages, uid, item.id]);

  // -------- Barra auto-oculta na rolagem vertical --------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || viewMode !== 'scroll') return;
    let last = el.scrollTop;
    const onScroll = () => {
      const st = el.scrollTop;
      const d = st - last;
      last = st;
      if (st < 48) setBarHidden(false);
      else if (d > 6) setBarHidden(true);
      else if (d < -6) setBarHidden(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [viewMode, load.status]);

  // -------- Pinça (dois dedos) para zoom --------
  // Durante o gesto aplicamos um scale de CSS (feedback imediato); ao soltar,
  // commitamos no estado `zoom`, que re-renderiza o PDF nítido na nova escala.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let pinching = false;
    let startDist = 0;
    let startZoom = 1;
    let factor = 1;
    const dist = (e: TouchEvent) =>
      Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    const target = () =>
      viewMode === 'page' ? stageRef.current : pagesWrapRef.current;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      startDist = dist(e);
      startZoom = zoomRef.current;
      factor = 1;
      setTurn(null); // pinça cancela virada em curso
    };
    const onMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault(); // impede a rolagem enquanto pinça
      factor = dist(e) / Math.max(1, startDist);
      const t = target();
      if (t) {
        t.style.transformOrigin = '50% 30%';
        t.style.transform = `scale(${factor})`;
      }
    };
    const onEnd = () => {
      if (!pinching) return;
      pinching = false;
      const t = target();
      if (t) t.style.transform = '';
      setZoom(Math.min(3, Math.max(0.5, +(startZoom * factor).toFixed(2))));
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [viewMode]);

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const list = map.get(a.page);
      if (list) list.push(a);
      else map.set(a.page, [a]);
    }
    return map;
  }, [annotations]);

  // -------- Criação de anotações --------
  const makeAnnotation = useCallback(
    (partial: Omit<Annotation, 'id' | 'itemId' | 'createdAt'>): Annotation => ({
      id: newAnnotationId(uid, item.id),
      itemId: item.id,
      createdAt: new Date().toISOString(),
      ...partial,
    }),
    [uid, item.id],
  );

  const handleCreateHighlight = useCallback(
    (page: number, rects: NormRect[], text: string) => {
      const a = makeAnnotation({ page, type: 'highlight', color: highlightColor, rects, text });
      void upsertAnnotation(uid, a);
    },
    [makeAnnotation, highlightColor, uid],
  );

  const handleCreateComment = useCallback(
    (page: number, anchor: { x: number; y: number }) => {
      setCommentText('');
      setCommentTitle('');
      setCommentTarget({ mode: 'new', anchor, page });
    },
    [],
  );

  const handleSelectAnnotation = useCallback((a: Annotation) => {
    setCommentText(a.comment ?? '');
    setCommentTitle(a.title ?? '');
    setCommentTarget({ mode: 'edit', annotation: a });
  }, []);

  const handleErase = useCallback(
    (a: Annotation) => {
      void deleteAnnotation(uid, item.id, a.id);
    },
    [uid, item.id],
  );

  function saveComment() {
    if (!commentTarget) return;
    const title = commentTitle.trim();
    const comment = commentText;
    if (commentTarget.mode === 'new') {
      const a = makeAnnotation({
        page: commentTarget.page,
        type: 'comment',
        color: highlightColor,
        comment,
        anchor: commentTarget.anchor,
        ...(title ? { title } : {}),
      });
      void upsertAnnotation(uid, a);
    } else {
      void upsertAnnotation(uid, { ...commentTarget.annotation, title, comment });
    }
    setCommentTarget(null);
  }

  function deleteCommentTarget() {
    if (commentTarget?.mode === 'edit') {
      void deleteAnnotation(uid, item.id, commentTarget.annotation.id);
    }
    setCommentTarget(null);
  }

  // -------- Converter marca-texto → nota/tarefa --------
  // Formata o corpo em markdown: o texto realçado vira uma citação (cada linha
  // prefixada com "> ") e o comentário do usuário fica abaixo.
  function quoteMarkdown(text: string): string {
    return text
      .trim()
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
  }

  function composeConvert(a: Annotation): { title: string; body: string } {
    const headline = item.title ? `${item.title} (p.${a.page})` : `p.${a.page}`;
    const title = commentTitle.trim() || a.title?.trim() || headline;
    const cite = a.text ? quoteMarkdown(a.text) : '';
    const body = [cite, commentText.trim()].filter(Boolean).join('\n\n');
    return { title, body };
  }

  // Converte a anotação aberta no editor em nota (Keep) ou tarefa (Tasks),
  // persistindo antes o título/comentário para não se perderem.
  async function convertFromEditor(dest: 'note' | 'task') {
    if (commentTarget?.mode !== 'edit') return;
    const a = commentTarget.annotation;
    await upsertAnnotation(uid, {
      ...a,
      title: commentTitle.trim(),
      comment: commentText,
    });
    const { title, body } = composeConvert(a);
    setCommentTarget(null);
    if (dest === 'note') {
      const noteId = await createNoteFromText(uid, title, body);
      onConverted('note', noteId);
    } else {
      const taskId = await createTaskFromText(uid, projects, title, body);
      if (taskId) onConverted('task', taskId);
    }
  }

  async function reconnectDrive() {
    try {
      await ensureDriveToken(uid);
      setLoad({ status: 'loading' });
      // Recarrega forçando novo fetch.
      const bytes = await fetchPdfBytes(uid, item.driveFileId);
      const doc = await loadPdfDocument(bytes);
      docRef.current = doc;
      setNumPages(doc.numPages);
      setLoad({ status: 'ready' });
    } catch (e) {
      setLoad({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // -------- Virada de página (modo livro) --------
  // Arrasto horizontal com o DEDO vira a página acompanhando o toque (a caneta
  // continua reservada para marcar). Soltar além de ~30% completa a virada com
  // animação; menos que isso, volta. Toques: bordas viram, centro alterna a
  // barra. Com zoom de pinça aplicado, o dedo faz pan na página.
  const turnPtr = useRef({ id: -1, x: 0, y: 0, lastX: 0, lastY: 0, active: false });
  const turnTimer = useRef<number | null>(null);

  function finishTurn(dir: 'next' | 'prev', complete: boolean) {
    turnTimer.current = null;
    if (complete) setPageIndex((i) => (dir === 'next' ? i + 1 : i - 1));
    setTurn(null);
  }

  function beginAnimatedTurn(dir: 'next' | 'prev') {
    if (turnTimer.current !== null) return;
    if (dir === 'next' && pageIndex >= numPages - 1) return;
    if (dir === 'prev' && pageIndex <= 0) return;
    setBarHidden(true);
    setTurn({ dir, progress: 0.02, animating: true });
    requestAnimationFrame(() =>
      setTurn((t) => (t ? { ...t, progress: 1 } : t)),
    );
    turnTimer.current = window.setTimeout(() => finishTurn(dir, true), 340);
  }

  function onBookPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== 'touch' || turn?.animating) return;
    turnPtr.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      active: true,
    };
  }

  function onBookPointerMove(e: React.PointerEvent) {
    const p = turnPtr.current;
    if (!p.active || e.pointerId !== p.id) return;
    // Com zoom aplicado, o dedo faz PAN na página (sem virar).
    if (zoom > 1.05) {
      bookRef.current?.scrollBy(p.lastX - e.clientX, p.lastY - e.clientY);
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!turn) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) {
        const dir: 'next' | 'prev' = dx < 0 ? 'next' : 'prev';
        if (
          (dir === 'next' && pageIndex < numPages - 1) ||
          (dir === 'prev' && pageIndex > 0)
        ) {
          setBarHidden(true);
          setTurn({ dir, progress: 0, animating: false });
        }
      }
      return;
    }
    if (!turn.animating) {
      const w = bookRef.current?.clientWidth || 1;
      const raw = turn.dir === 'next' ? -dx : dx;
      setTurn({
        ...turn,
        progress: Math.min(1, Math.max(0, raw / (w * 0.8))),
      });
    }
  }

  function onBookPointerUp(e: React.PointerEvent) {
    const p = turnPtr.current;
    if (!p.active || e.pointerId !== p.id) return;
    p.active = false;
    if (turn && !turn.animating) {
      const complete = turn.progress > 0.3;
      setTurn({ ...turn, progress: complete ? 1 : 0, animating: true });
      turnTimer.current = window.setTimeout(
        () => finishTurn(turn.dir, complete),
        340,
      );
      return;
    }
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (dist <= 8 && !turn) {
      const rect = bookRef.current?.getBoundingClientRect();
      const rx = rect ? (e.clientX - rect.left) / rect.width : 0.5;
      if (rx < 0.16) beginAnimatedTurn('prev');
      else if (rx > 0.84) beginAnimatedTurn('next');
      else setBarHidden((v) => !v);
    }
  }

  function onBookPointerCancel() {
    turnPtr.current.active = false;
    setTurn((t) => (t && !t.animating ? null : t));
  }

  // Camadas do livro: [anterior, atual, próxima] montadas juntas (as vizinhas
  // ficam ocultas mas pré-renderizadas → virada sem página em branco).
  function bookLayers() {
    const curN = pageIndex + 1;
    const nums = [curN - 1, curN, curN + 1].filter(
      (n) => n >= 1 && n <= numPages,
    );
    const progress = turn?.progress ?? 0;
    const shade = Math.sin(Math.PI * progress) * 0.4;
    return nums.map((n) => {
      let style: React.CSSProperties = { zIndex: 1, visibility: 'hidden' };
      let flipping = false;
      if (n === curN) {
        if (turn?.dir === 'next') {
          flipping = true;
          style = {
            zIndex: 3,
            transform: `rotateY(${-180 * progress}deg)`,
          };
        } else {
          style = { zIndex: 2 };
        }
      } else if (n === curN + 1 && turn?.dir === 'next') {
        style = { zIndex: 1 }; // destino visível por baixo
      } else if (n === curN - 1 && turn?.dir === 'prev') {
        flipping = true;
        style = {
          zIndex: 3,
          transform: `rotateY(${-180 * (1 - progress)}deg)`,
        };
      }
      const interactive = !turn && n === curN;
      return (
        <div
          key={n}
          className={`book-layer${flipping ? ' book-flip' : ''}${
            flipping && turn?.animating ? ' animating' : ''
          }`}
          style={{ ...style, pointerEvents: interactive ? 'auto' : 'none' }}
        >
          <LazyPdfPage
            getDoc={() => docRef.current}
            pageNumber={n}
            targetWidth={bookPageWidth}
            baseAspect={baseAspect}
            annotations={annotationsByPage.get(n) ?? []}
            tool={tool}
            color={highlightColor}
            onCreateHighlight={(rects, text) => handleCreateHighlight(n, rects, text)}
            onCreateComment={(anchor) => handleCreateComment(n, anchor)}
            onSelectAnnotation={handleSelectAnnotation}
            onEraseAnnotation={handleErase}
          />
          {flipping && <div className="book-shade" style={{ opacity: shade }} />}
        </div>
      );
    });
  }

  return (
    <div className="reader-view">
      <header
        ref={toolbarRef}
        className={`reader-toolbar${barHidden ? ' hidden' : ''}`}
        style={
          barHidden
            ? { marginTop: -(toolbarRef.current?.offsetHeight ?? 72) }
            : undefined
        }
      >
        <button type="button" className="reader-back" onClick={onClose} aria-label="Voltar">
          ←
        </button>
        <span className="reader-title" title={item.title}>
          {item.title || '(sem título)'}
        </span>

        {/* Sem botões de ferramenta: a caneta já marca direto, tocar numa
            marcação abre o comentário e o botão da S-Pen apaga. Fica só a
            paleta de cores do marca-texto. */}
        <div className="reader-colors" aria-label="Cor do marca-texto">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`reader-color${highlightColor === c ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => setHighlightColor(c)}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>

        <button
          type="button"
          className="reader-mode-btn"
          onClick={() => {
            setTurn(null);
            setBarHidden(false);
            setViewMode((m) => (m === 'scroll' ? 'page' : 'scroll'));
          }}
          title={viewMode === 'scroll' ? 'Modo página (horizontal)' : 'Modo rolagem (vertical)'}
          aria-label={viewMode === 'scroll' ? 'Mudar para modo página' : 'Mudar para modo rolagem'}
        >
          {viewMode === 'scroll' ? '📖' : '📜'}
        </button>

        <div className="reader-zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))} aria-label="Diminuir zoom">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.15))} aria-label="Aumentar zoom">+</button>
        </div>

        <button type="button" className="reader-meta-btn" onClick={() => setMetaOpen(true)}>
          Metadados
        </button>
        <button
          type="button"
          className={`reader-panel-btn${panelOpen ? ' active' : ''}`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          Anotações ({annotations.length})
        </button>
        {/* TEMPORÁRIO: exporta o retrato da última marcação (geometria real do
            aparelho) para depurar o vazamento entre colunas. */}
        <button
          type="button"
          className="reader-panel-btn"
          title="Exportar diagnóstico da última marcação"
          aria-label="Exportar diagnóstico da última marcação"
          onClick={() => {
            const dump = (window as unknown as { __lastSelDebug?: unknown }).__lastSelDebug;
            if (!dump) {
              alert('Faça uma marcação primeiro, depois toque no 🔬.');
              return;
            }
            const text = JSON.stringify(dump);
            const nav = navigator as Navigator & {
              share?: (d: { text: string }) => Promise<void>;
            };
            navigator.clipboard
              ?.writeText(text)
              .then(() => alert('Diagnóstico copiado! Cole no chat.'))
              .catch(() => {
                if (nav.share) void nav.share({ text });
                else alert(text.slice(0, 1500));
              });
          }}
        >
          🔬
        </button>
      </header>

      <div className="reader-body" ref={bodyRef}>
        {viewMode === 'scroll' ? (
          <div className="reader-scroll" ref={scrollRef}>
            {load.status === 'loading' && <p className="reader-status">Carregando documento…</p>}
            {load.status === 'error' && <p className="reader-status error">{load.message}</p>}
            {load.status === 'needs-drive' && (
              <div className="reader-status">
                <p>{load.message}</p>
                <button type="button" onClick={reconnectDrive}>
                  Reconectar Google Drive
                </button>
              </div>
            )}
            {load.status === 'ready' && areaSize.w > 0 && (
              <div className="reader-pages" ref={pagesWrapRef}>
                {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
                  <LazyPdfPage
                    key={pageNumber}
                    getDoc={() => docRef.current}
                    pageNumber={pageNumber}
                    targetWidth={targetWidth}
                    baseAspect={baseAspect}
                    annotations={annotationsByPage.get(pageNumber) ?? []}
                    tool={tool}
                    color={highlightColor}
                    onCreateHighlight={(rects, text) => handleCreateHighlight(pageNumber, rects, text)}
                    onCreateComment={(anchor) => handleCreateComment(pageNumber, anchor)}
                    onSelectAnnotation={handleSelectAnnotation}
                    onEraseAnnotation={handleErase}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className="reader-book"
            ref={bookRef}
            onPointerDown={onBookPointerDown}
            onPointerMove={onBookPointerMove}
            onPointerUp={onBookPointerUp}
            onPointerCancel={onBookPointerCancel}
          >
            {load.status === 'loading' && <p className="reader-status">Carregando documento…</p>}
            {load.status === 'error' && <p className="reader-status error">{load.message}</p>}
            {load.status === 'needs-drive' && (
              <div className="reader-status">
                <p>{load.message}</p>
                <button type="button" onClick={reconnectDrive}>
                  Reconectar Google Drive
                </button>
              </div>
            )}
            {load.status === 'ready' && areaSize.w > 0 && (
              <>
                <div
                  className="book-stage"
                  ref={stageRef}
                  style={{
                    width: bookPageWidth,
                    height: bookPageWidth * baseAspect,
                  }}
                >
                  {bookLayers()}
                </div>
                <div className="book-pagenum" aria-live="polite">
                  {pageIndex + 1} / {numPages}
                </div>
              </>
            )}
          </div>
        )}

        {panelOpen && (
          <aside className="reader-panel">
            <h3>Anotações</h3>
            {annotations.length === 0 && <p className="muted">Nenhuma anotação ainda.</p>}
            <ul className="reader-annotation-list">
              {annotations.map((a) => (
                <li key={a.id} className="reader-annotation-item">
                  <span className="reader-annotation-page">p.{a.page}</span>
                  <span className="reader-annotation-type">
                    {a.type === 'highlight' ? '🖍️' : a.type === 'comment' ? '💬' : '🖊️'}
                  </span>
                  <span className="reader-annotation-text">
                    {a.title || a.text || a.comment || (a.type === 'ink' ? '(manuscrito)' : '')}
                  </span>
                  {a.type === 'highlight' && (
                    <button
                      type="button"
                      onClick={() => handleSelectAnnotation(a)}
                      title="Abrir / comentar / converter"
                    >
                      ✏️
                    </button>
                  )}
                  <button type="button" onClick={() => handleErase(a)} title="Excluir">
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      {commentTarget && (
        <>
          <div className="share-dialog-backdrop" onClick={() => setCommentTarget(null)} aria-hidden="true" />
          <div className="share-dialog reader-annot-editor" role="dialog" aria-modal="true">
            <h2>Anotação</h2>

            <label className="metadata-field">
              <span>Título (vira o título da nota/tarefa)</span>
              <input
                value={commentTitle}
                onChange={(e) => setCommentTitle(e.target.value)}
                placeholder="ex.: Emissões incorporadas — ponto-chave"
              />
            </label>

            {commentTarget.mode === 'edit' && commentTarget.annotation.text?.trim() && (
              <div className="reader-citation">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {quoteMarkdown(commentTarget.annotation.text)}
                </ReactMarkdown>
              </div>
            )}

            <label className="metadata-field">
              <span>Comentário</span>
              <textarea
                className="reader-comment-input"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={4}
                placeholder="Seu comentário…"
              />
            </label>

            <div className="share-dialog-actions">
              <button type="button" onClick={saveComment}>
                Salvar
              </button>
              {commentTarget.mode === 'edit' && commentTarget.annotation.text?.trim() && (
                <>
                  <button
                    type="button"
                    onClick={() => void convertFromEditor('task')}
                    disabled={pickDefaultProjectId(projects) === null}
                  >
                    → Tarefa
                  </button>
                  <button type="button" onClick={() => void convertFromEditor('note')}>
                    → Anotação
                  </button>
                </>
              )}
              {commentTarget.mode === 'edit' && (
                <button type="button" className="share-dialog-secondary" onClick={deleteCommentTarget}>
                  Excluir
                </button>
              )}
              <button type="button" className="share-dialog-secondary" onClick={() => setCommentTarget(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}

      {metaOpen && (
        <MetadataEditor
          item={item}
          allTypes={item.itemType ? [item.itemType] : []}
          onSave={(patch) => saveReadingMetadata(uid, item, patch)}
          onClose={() => setMetaOpen(false)}
        />
      )}
    </div>
  );
}

// Renderiza uma página só quando ela entra (ou se aproxima) da viewport, para
// não materializar centenas de canvases de uma vez em livros longos.
function LazyPdfPage({
  getDoc,
  pageNumber,
  targetWidth,
  baseAspect,
  annotations,
  tool,
  color,
  onCreateHighlight,
  onCreateComment,
  onSelectAnnotation,
  onEraseAnnotation,
}: {
  getDoc: () => PDFDocumentProxy | null;
  pageNumber: number;
  targetWidth: number;
  baseAspect: number;
  annotations: Annotation[];
  tool: ReaderTool;
  color: string;
  onCreateHighlight: (rects: NormRect[], text: string) => void;
  onCreateComment: (anchor: { x: number; y: number }) => void;
  onSelectAnnotation: (a: Annotation) => void;
  onEraseAnnotation: (a: Annotation) => void;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (visible) return;
    const el = slotRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || page) return;
    let cancelled = false;
    const doc = getDoc();
    if (!doc) return;
    doc.getPage(pageNumber).then((p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale: 1 });
      setScale(targetWidth / vp.width);
      setPage(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pageNumber]);

  // Reage a mudanças de zoom/largura recalculando a escala.
  useEffect(() => {
    if (!page) return;
    const vp = page.getViewport({ scale: 1 });
    setScale(targetWidth / vp.width);
  }, [targetWidth, page]);

  return (
    <div
      ref={slotRef}
      className="pdf-page-slot"
      style={page ? undefined : { height: targetWidth * baseAspect, width: targetWidth }}
    >
      {page && (
        <PdfPageView
          page={page}
          pageNumber={pageNumber}
          scale={scale}
          annotations={annotations}
          tool={tool}
          color={color}
          onCreateHighlight={onCreateHighlight}
          onCreateComment={onCreateComment}
          onSelectAnnotation={onSelectAnnotation}
          onEraseAnnotation={onEraseAnnotation}
        />
      )}
    </div>
  );
}

// Autodetecção de DOI a partir do texto da 1ª página.
async function autoDetectDoi(
  doc: PDFDocumentProxy,
  uid: string,
  item: ReadingItem,
): Promise<void> {
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ');
    const doi = extractDoiFromText(text);
    if (doi) {
      void patchReadingItem(uid, item.id, { doi });
    }
  } catch {
    // ignora — autodetecção é best-effort
  }
}
