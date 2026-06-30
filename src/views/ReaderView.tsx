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
import { patchReadingItem } from '../repositories/readingItemsRepo';
import { PdfPageView, type ReaderTool } from '../components/PdfPageView';
import { MetadataEditor } from '../components/MetadataEditor';
import {
  ShareTargetDialog,
  type ShareTargetDialogState,
} from '../components/ShareTargetDialog';
import { createNoteFromText, createTaskFromText, pickDefaultProjectId } from '../lib/createFromText';
import { transcribeImage } from '../lib/aiTranscribe';
import { rasterizeInkRegion } from '../lib/inkRaster';
import type { Annotation, InkStroke, NormRect, Project, ReadingItem } from '../types';

const HIGHLIGHT_COLORS = ['#ffd54a', '#a5d6a7', '#90caf9', '#f48fb1', '#ce93d8'];
const INK_COLORS = ['#1a1a1a', '#e53935', '#1e88e5', '#43a047'];
const PEN_WIDTH_FRACTION = 0.004; // ~0.4% da largura da página

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
  const [tool, setTool] = useState<ReaderTool>('highlight');
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [zoom, setZoom] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Editor de comentário: novo (com anchor) ou edição de uma anotação existente.
  const [commentTarget, setCommentTarget] = useState<
    | { mode: 'new'; anchor: { x: number; y: number }; page: number }
    | { mode: 'edit'; annotation: Annotation }
    | null
  >(null);
  const [commentText, setCommentText] = useState('');

  // Conversão de anotação → nota/tarefa (reusa o ShareTargetDialog).
  const [convert, setConvert] = useState<
    | { state: ShareTargetDialogState; title: string; text: string }
    | null
  >(null);

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

  // -------- Largura do container (responsivo) --------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [load.status]);

  const targetWidth = Math.min(Math.max(containerWidth - 24, 280), 1000) * zoom;

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

  const handleCreateInk = useCallback(
    (page: number, stroke: InkStroke) => {
      const a = makeAnnotation({ page, type: 'ink', color: inkColor, strokes: [stroke] });
      void upsertAnnotation(uid, a);
    },
    [makeAnnotation, inkColor, uid],
  );

  const handleCreateComment = useCallback(
    (page: number, anchor: { x: number; y: number }) => {
      setCommentText('');
      setCommentTarget({ mode: 'new', anchor, page });
    },
    [],
  );

  const handleSelectAnnotation = useCallback((a: Annotation) => {
    setCommentText(a.comment ?? '');
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
    if (commentTarget.mode === 'new') {
      const a = makeAnnotation({
        page: commentTarget.page,
        type: 'comment',
        color: highlightColor,
        comment: commentText,
        anchor: commentTarget.anchor,
      });
      void upsertAnnotation(uid, a);
    } else {
      void upsertAnnotation(uid, { ...commentTarget.annotation, comment: commentText });
    }
    setCommentTarget(null);
  }

  function deleteCommentTarget() {
    if (commentTarget?.mode === 'edit') {
      void deleteAnnotation(uid, item.id, commentTarget.annotation.id);
    }
    setCommentTarget(null);
  }

  // -------- Converter anotação → nota/tarefa --------
  async function startConvert(a: Annotation) {
    const headline = item.title ? `${item.title} (p.${a.page})` : `p.${a.page}`;
    if (a.type === 'ink') {
      setConvert({ state: { status: 'loading' }, title: headline, text: '' });
      try {
        const doc = docRef.current;
        if (!doc) throw new Error('Documento não carregado.');
        const img = await rasterizeInkRegion(doc, a);
        const result = await transcribeImage(img);
        setConvert({
          state: { status: 'choose', title: result.title || headline, text: result.text },
          title: result.title || headline,
          text: result.text,
        });
      } catch (e) {
        setConvert({
          state: { status: 'error', message: e instanceof Error ? e.message : String(e) },
          title: headline,
          text: '',
        });
      }
      return;
    }
    // highlight / comment: o texto já existe.
    const body = [a.text, a.comment].filter(Boolean).join('\n\n');
    setConvert({
      state: { status: 'choose', title: headline, text: body },
      title: headline,
      text: body,
    });
  }

  async function convertToNote() {
    if (!convert || convert.state.status !== 'choose') return;
    const refLine = `↪ ${item.title || 'Leitura'}`;
    const noteId = await createNoteFromText(
      uid,
      convert.state.title,
      `${convert.state.text}\n\n${refLine}`,
    );
    setConvert(null);
    onConverted('note', noteId);
  }

  async function convertToTask() {
    if (!convert || convert.state.status !== 'choose') return;
    const taskId = await createTaskFromText(uid, projects, convert.state.title, convert.state.text);
    if (!taskId) return;
    setConvert(null);
    onConverted('task', taskId);
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

  const activeColor = tool === 'pen' ? inkColor : highlightColor;
  const colorChoices = tool === 'pen' ? INK_COLORS : HIGHLIGHT_COLORS;

  return (
    <div className="reader-view">
      <header className="reader-toolbar">
        <button type="button" className="reader-back" onClick={onClose} aria-label="Voltar">
          ←
        </button>
        <span className="reader-title" title={item.title}>
          {item.title || '(sem título)'}
        </span>

        <div className="reader-tools" role="toolbar" aria-label="Ferramentas de anotação">
          <ToolButton tool="pan" current={tool} setTool={setTool} label="Navegar" icon="✋" />
          <ToolButton tool="highlight" current={tool} setTool={setTool} label="Marca-texto" icon="🖍️" />
          <ToolButton tool="comment" current={tool} setTool={setTool} label="Comentário" icon="💬" />
          <ToolButton tool="pen" current={tool} setTool={setTool} label="Caneta (S-Pen)" icon="🖊️" />
          <ToolButton tool="eraser" current={tool} setTool={setTool} label="Borracha" icon="🧽" />
        </div>

        {(tool === 'highlight' || tool === 'pen' || tool === 'comment') && (
          <div className="reader-colors" aria-label="Cor">
            {colorChoices.map((c) => (
              <button
                key={c}
                type="button"
                className={`reader-color${activeColor === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => (tool === 'pen' ? setInkColor(c) : setHighlightColor(c))}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
        )}

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
      </header>

      <div className="reader-body">
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
          {load.status === 'ready' &&
            containerWidth > 0 &&
            Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
              <LazyPdfPage
                key={pageNumber}
                getDoc={() => docRef.current}
                pageNumber={pageNumber}
                targetWidth={targetWidth}
                baseAspect={baseAspect}
                annotations={annotationsByPage.get(pageNumber) ?? []}
                tool={tool}
                color={activeColor}
                penWidthFraction={PEN_WIDTH_FRACTION}
                onCreateHighlight={(rects, text) => handleCreateHighlight(pageNumber, rects, text)}
                onCreateInk={(stroke) => handleCreateInk(pageNumber, stroke)}
                onCreateComment={(anchor) => handleCreateComment(pageNumber, anchor)}
                onSelectAnnotation={handleSelectAnnotation}
                onEraseAnnotation={handleErase}
              />
            ))}
        </div>

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
                    {a.text || a.comment || (a.type === 'ink' ? '(manuscrito)' : '')}
                  </span>
                  {a.type === 'highlight' && (
                    <button
                      type="button"
                      onClick={() => startConvert(a)}
                      title="Converter em nota/tarefa"
                    >
                      ↪
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
          <div className="share-dialog" role="dialog" aria-modal="true">
            <h2>Comentário</h2>
            <textarea
              className="reader-comment-input"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className="share-dialog-actions">
              <button type="button" onClick={saveComment}>
                Salvar
              </button>
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

      {convert && (
        <ShareTargetDialog
          state={convert.state}
          canCreateTask={pickDefaultProjectId(projects) !== null}
          onCreateTask={() => void convertToTask()}
          onCreateNote={() => void convertToNote()}
          onCancel={() => setConvert(null)}
        />
      )}

      {metaOpen && (
        <MetadataEditor
          item={item}
          onSave={(patch) => {
            void patchReadingItem(uid, item.id, patch);
            setMetaOpen(false);
          }}
          onClose={() => setMetaOpen(false)}
        />
      )}
    </div>
  );
}

function ToolButton({
  tool,
  current,
  setTool,
  label,
  icon,
}: {
  tool: ReaderTool;
  current: ReaderTool;
  setTool: (t: ReaderTool) => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      className={`reader-tool${current === tool ? ' active' : ''}`}
      onClick={() => setTool(tool)}
      aria-pressed={current === tool}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
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
  penWidthFraction,
  onCreateHighlight,
  onCreateInk,
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
  penWidthFraction: number;
  onCreateHighlight: (rects: NormRect[], text: string) => void;
  onCreateInk: (stroke: InkStroke) => void;
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
          penWidthFraction={penWidthFraction}
          onCreateHighlight={onCreateHighlight}
          onCreateInk={onCreateInk}
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
