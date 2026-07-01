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
          <ToolButton tool="highlight" current={tool} setTool={setTool} label="Marca-texto" icon="🖍️" />
          <ToolButton tool="comment" current={tool} setTool={setTool} label="Comentário" icon="💬" />
          <ToolButton tool="eraser" current={tool} setTool={setTool} label="Borracha" icon="🧽" />
        </div>

        {tool === 'highlight' && (
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
                color={highlightColor}
                onCreateHighlight={(rects, text) => handleCreateHighlight(pageNumber, rects, text)}
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
          onSave={(patch) => saveReadingMetadata(uid, item, patch)}
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
