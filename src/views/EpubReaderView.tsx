import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadEpubBook, authorsFromEpubCreator, type Book, type Rendition } from '../lib/epub';
import { fetchReadingFileBytes } from '../lib/readingDocs';
import { DriveAuthError, ensureDriveToken } from '../lib/googleDrive';
import {
  newAnnotationId,
  subscribeToAnnotations,
  upsertAnnotation,
  deleteAnnotation,
} from '../repositories/annotationsRepo';
import { patchReadingItem, saveReadingMetadata } from '../repositories/readingItemsRepo';
import { MetadataEditor } from '../components/MetadataEditor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createNoteFromText, createTaskFromText, pickDefaultProjectId } from '../lib/createFromText';
import { composeAnnotationConversion, quoteMarkdown } from '../lib/annotationConvert';
import type { Annotation, Project, ReadingItem } from '../types';

// Leitor de EPUB — irmão do ReaderView (PDF), mas com um núcleo de render
// bem diferente: em vez de montar um <PdfPageView> por página (canvas +
// camada de texto do pdf.js), o epub.js gerencia sozinho UM iframe de
// conteúdo reflowable, navegando por CFI (Canonical Fragment Identifier) em
// vez de número de página fixo. Por isso o marca-texto aqui usa a seleção
// NATIVA do navegador dentro do iframe (mais simples que a geometria manual
// do PdfPageView) e ancora pelo CFI — o que sobrevive a mudanças de fonte/
// tamanho de tela, ao contrário de retângulos em pixel.
//
// Limitações conscientes desta primeira versão (documentadas, não escondidas):
//  - Sem tinta da S-Pen: texto reflowable não tem coordenadas de pixel
//    estáveis entre re-paginações (mudar fonte/girar a tela desloca tudo).
//  - Sem detecção automática de DOI / classificação por IA: essas rotinas
//    leem o PDF via pdf.js; adaptá-las para EPUB fica para depois.
//  - Sem pinça de zoom: o zoom aqui é por tamanho de fonte (botões +/-), não
//    por escala visual — não faz sentido "ampliar" texto que já reflui.
const HIGHLIGHT_COLORS = ['#ffd54a', '#a5d6a7', '#90caf9', '#f48fb1', '#ce93d8'];
const VIEW_MODE_KEY = 'app-produtividade:reader-view-mode';
const LOCATIONS_CHARS_PER_PAGE = 1600;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }
  | { status: 'needs-drive'; message: string };

export function EpubReaderView({
  uid,
  item,
  projects,
  onClose,
  onConverted,
  focusAnnotationId,
  onFocusHandled,
}: {
  uid: string;
  item: ReadingItem;
  projects: Project[];
  onClose: () => void;
  onConverted: (dest: 'note' | 'task', id: string) => void;
  focusAnnotationId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [numLocations, setNumLocations] = useState(0);
  const [currentLoc, setCurrentLoc] = useState({ index: 0, cfi: '' });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationsRef = useRef<Annotation[]>([]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);
  // CFIs de marca-texto já desenhados no epub.js (id → cfiRange), para só
  // adicionar/remover o que mudou a cada atualização em tempo real.
  const appliedHighlights = useRef(new Map<string, string>());

  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [zoom, setZoom] = useState(1); // vira % de fonte, não escala visual
  const [panelOpen, setPanelOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
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

  const [commentTarget, setCommentTarget] = useState<Annotation | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentTitle, setCommentTitle] = useState('');

  const [autoTaskWarning, setAutoTaskWarning] = useState<string | null>(null);

  function openEditor(a: Annotation) {
    setCommentText(a.comment ?? '');
    setCommentTitle(a.title ?? '');
    setCommentTarget(a);
  }

  // Página "sintética" (1-based) a partir de um CFI, usada para citação ABNT,
  // ordenação e o "p.X" mostrado na UI — o mesmo índice que já orienta o
  // restante do app para PDFs, só que aqui vem de `book.locations` (fatias de
  // ~1600 caracteres) em vez de uma página real do documento.
  const pageFromCfi = useCallback((cfi: string): number => {
    const book = bookRef.current;
    if (!book || numLocations === 0) return 1;
    const loc = book.locations.locationFromCfi(cfi);
    return (typeof loc === 'number' ? loc : 0) + 1;
  }, [numLocations]);

  // -------- Carregamento do EPUB --------
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    (async () => {
      try {
        const bytes = await fetchReadingFileBytes(uid, item.driveFileId);
        if (cancelled) return;
        const book = await loadEpubBook(bytes);
        if (cancelled) return;
        bookRef.current = book;
        await book.locations.generate(LOCATIONS_CHARS_PER_PAGE);
        if (cancelled) return;
        setNumLocations(book.locations.length());
        setLoad({ status: 'ready' });
        void patchReadingItem(uid, item.id, {
          lastOpenedAt: new Date().toISOString(),
          ...(item.readingStatus === 'to-read' ? { readingStatus: 'reading' } : {}),
        });
        // Preenche título/autores a partir da metadata do EPUB na primeira
        // abertura, se ainda não há nada — equivalente ao autodetect de DOI
        // do leitor de PDF, só que aqui a informação já vem pronta no OPF.
        if (item.authors.length === 0) {
          void autoFillMetadata(book, uid, item, setAutoTaskWarning);
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
      // A Rendition (se houver) é destruída pelo próprio efeito que a criou
      // logo abaixo — destruí-la aqui também bateria duas vezes no mesmo
      // objeto. Este cleanup só cuida do Book e do cancelamento do load.
      bookRef.current?.destroy();
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, item.id, item.driveFileId]);

  // -------- Anotações em tempo real --------
  useEffect(() => {
    return subscribeToAnnotations(uid, item.id, setAnnotations);
  }, [uid, item.id]);

  // -------- Monta a Rendition assim que o livro estiver pronto --------
  useEffect(() => {
    if (load.status !== 'ready') return;
    const book = bookRef.current;
    const el = viewportRef.current;
    if (!book || !el) return;

    const rendition = book.renderTo(el, {
      width: '100%',
      height: '100%',
      flow: viewMode === 'page' ? 'paginated' : 'scrolled-doc',
      spread: 'none',
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;
    rendition.themes.fontSize(`${Math.round(zoom * 100)}%`);

    rendition.on('relocated', (location: { start: { cfi: string } }) => {
      const cfi = location.start.cfi;
      setCurrentLoc({ index: pageFromCfi(cfi) - 1, cfi });
    });

    rendition.on(
      'selected',
      (cfiRange: string, contents: { window: Window }) => {
        const text = contents.window.getSelection()?.toString().trim() ?? '';
        contents.window.getSelection()?.removeAllRanges();
        if (!text) return;
        handleCreateHighlight(cfiRange, text);
      },
    );

    const startCfi = item.currentPage
      ? book.locations.cfiFromLocation(item.currentPage - 1)
      : undefined;
    void rendition.display(startCfi || undefined);

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        rendition.resize(el.clientWidth, el.clientHeight);
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      rendition.destroy();
      renditionRef.current = null;
      appliedHighlights.current.clear();
    };
    // Recria a rendition ao trocar o modo de visualização (paginado ↔
    // rolagem) — o epub.js não troca `flow` com segurança numa instância já
    // montada em todas as versões, então uma nova instância é o caminho
    // robusto, retomando de onde estava via `startCfi`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status, viewMode]);

  // -------- Tamanho de fonte (zoom) --------
  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${Math.round(zoom * 100)}%`);
  }, [zoom]);

  // -------- Persiste a página atual (debounced) --------
  useEffect(() => {
    if (load.status !== 'ready' || numLocations === 0) return;
    const t = window.setTimeout(() => {
      void patchReadingItem(uid, item.id, { currentPage: currentLoc.index + 1 });
    }, 800);
    return () => window.clearTimeout(t);
  }, [currentLoc.index, load.status, numLocations, uid, item.id]);

  // -------- Desenha marca-texto: só a diferença desde a última renderização --------
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || load.status !== 'ready') return;
    const applied = appliedHighlights.current;
    const currentIds = new Set(annotations.map((a) => a.id));
    for (const [id, cfi] of applied) {
      if (!currentIds.has(id)) {
        rendition.annotations.remove(cfi, 'highlight');
        applied.delete(id);
      }
    }
    for (const a of annotations) {
      if (a.type !== 'highlight' || !a.cfi || applied.has(a.id)) continue;
      rendition.annotations.highlight(
        a.cfi,
        {},
        () => {
          const current = annotationsRef.current.find((x) => x.id === a.id);
          if (current) openEditor(current);
        },
        'epub-highlight',
        { fill: a.color, 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' },
      );
      applied.set(a.id, a.cfi);
    }
  }, [annotations, load.status]);

  // -------- Foco numa anotação ao chegar via vínculo tarefa/nota → EPUB --------
  useEffect(() => {
    if (!focusAnnotationId || load.status !== 'ready') return;
    const target = annotations.find((a) => a.id === focusAnnotationId);
    if (!target?.cfi) return;
    void renditionRef.current?.display(target.cfi);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAnnotationId, load.status, annotations]);

  const highlightColorRef = useRef(highlightColor);
  useEffect(() => {
    highlightColorRef.current = highlightColor;
  }, [highlightColor]);

  function handleCreateHighlight(cfiRange: string, text: string) {
    const a: Annotation = {
      id: newAnnotationId(uid, item.id),
      itemId: item.id,
      page: pageFromCfi(cfiRange),
      type: 'highlight',
      color: highlightColorRef.current,
      cfi: cfiRange,
      text,
      createdAt: new Date().toISOString(),
    };
    void upsertAnnotation(uid, a);
  }

  function handleErase(a: Annotation) {
    if (a.cfi) renditionRef.current?.annotations.remove(a.cfi, 'highlight');
    appliedHighlights.current.delete(a.id);
    void deleteAnnotation(uid, item.id, a.id);
  }

  function saveComment() {
    if (!commentTarget) return;
    void upsertAnnotation(uid, {
      ...commentTarget,
      title: commentTitle.trim(),
      comment: commentText,
    });
    setCommentTarget(null);
  }

  function deleteCommentTarget() {
    if (commentTarget) handleErase(commentTarget);
    setCommentTarget(null);
  }

  async function convertFromEditor(dest: 'note' | 'task') {
    if (!commentTarget) return;
    const a = commentTarget;
    const title_ = commentTitle.trim();
    await upsertAnnotation(uid, { ...a, title: title_, comment: commentText });
    const { title, body } = composeAnnotationConversion(item, a, commentTitle, commentText);
    setCommentTarget(null);
    const source = { itemId: item.id, annotationId: a.id };
    if (dest === 'note') {
      const noteId = await createNoteFromText(uid, title, body, source);
      await upsertAnnotation(uid, { ...a, title: title_, comment: commentText, linkedNoteId: noteId });
      onConverted('note', noteId);
    } else {
      const taskId = await createTaskFromText(uid, projects, title, body, source);
      if (taskId) {
        await upsertAnnotation(uid, { ...a, title: title_, comment: commentText, linkedTaskId: taskId });
        onConverted('task', taskId);
      }
    }
  }

  function openLinked(dest: 'task' | 'note', id: string) {
    setCommentTarget(null);
    onConverted(dest, id);
  }

  async function reconnectDrive() {
    try {
      await ensureDriveToken(uid);
      setLoad({ status: 'loading' });
      const bytes = await fetchReadingFileBytes(uid, item.driveFileId);
      const book = await loadEpubBook(bytes);
      bookRef.current = book;
      await book.locations.generate(LOCATIONS_CHARS_PER_PAGE);
      setNumLocations(book.locations.length());
      setLoad({ status: 'ready' });
    } catch (e) {
      setLoad({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const progressLabel = useMemo(() => {
    if (numLocations === 0) return '';
    return `${currentLoc.index + 1} / ${numLocations}`;
  }, [currentLoc, numLocations]);

  return (
    <div className="reader-view">
      <header className="reader-toolbar">
        <button type="button" className="reader-back" onClick={onClose} aria-label="Voltar">
          ←
        </button>
        <span className="reader-title" title={item.title}>
          {item.title || '(sem título)'}
        </span>

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

        {viewMode === 'page' && (
          <div className="epub-pager">
            <button type="button" onClick={() => void renditionRef.current?.prev()} aria-label="Página anterior">
              ‹
            </button>
            <button type="button" onClick={() => void renditionRef.current?.next()} aria-label="Próxima página">
              ›
            </button>
          </div>
        )}

        <button
          type="button"
          className="reader-mode-btn"
          onClick={() => setViewMode((m) => (m === 'scroll' ? 'page' : 'scroll'))}
          title={viewMode === 'scroll' ? 'Modo página' : 'Modo rolagem'}
          aria-label={viewMode === 'scroll' ? 'Mudar para modo página' : 'Mudar para modo rolagem'}
        >
          {viewMode === 'scroll' ? '📖' : '📜'}
        </button>

        <div className="reader-zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))} aria-label="Diminuir fonte">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} aria-label="Aumentar fonte">+</button>
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

      {autoTaskWarning && (
        <div className="toast toast-row" role="status">
          <span>{autoTaskWarning}</span>
          <button type="button" className="btn-link" onClick={() => setAutoTaskWarning(null)}>
            Ok
          </button>
        </div>
      )}

      <div className="reader-body">
        <div className="epub-body-wrap">
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
          <div
            className="epub-viewport"
            ref={viewportRef}
            style={{ visibility: load.status === 'ready' ? 'visible' : 'hidden' }}
          >
            {load.status === 'ready' && viewMode === 'page' && (
              <>
                <button
                  type="button"
                  className="epub-tap-zone epub-tap-prev"
                  onClick={() => void renditionRef.current?.prev()}
                  aria-label="Página anterior"
                />
                <button
                  type="button"
                  className="epub-tap-zone epub-tap-next"
                  onClick={() => void renditionRef.current?.next()}
                  aria-label="Próxima página"
                />
              </>
            )}
          </div>
          {load.status === 'ready' && progressLabel && (
            <div className="book-pagenum" aria-live="polite">
              {progressLabel}
            </div>
          )}
        </div>

        {panelOpen && (
          <aside className="reader-panel">
            <h3>Anotações</h3>
            {annotations.length === 0 && <p className="muted">Nenhuma anotação ainda.</p>}
            <ul className="reader-annotation-list">
              {annotations.map((a) => (
                <li key={a.id} className="reader-annotation-item">
                  <span className="reader-annotation-page">p.{a.page}</span>
                  <span className="reader-annotation-type">🖍️</span>
                  <span className="reader-annotation-text">
                    {a.title || a.text || a.comment || ''}
                  </span>
                  {(a.linkedTaskId || a.linkedNoteId) && (
                    <span className="reader-annotation-linked" title="Vinculada a uma tarefa/nota">
                      🔗
                    </span>
                  )}
                  <button type="button" onClick={() => openEditor(a)} title="Abrir / comentar / converter">
                    ✏️
                  </button>
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

            {commentTarget.text?.trim() && (
              <div className="reader-citation">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {quoteMarkdown(commentTarget.text)}
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
              {commentTarget.text?.trim() && (
                <>
                  {commentTarget.linkedTaskId ? (
                    <button type="button" onClick={() => openLinked('task', commentTarget.linkedTaskId!)}>
                      Abrir tarefa ↗
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void convertFromEditor('task')}
                      disabled={pickDefaultProjectId(projects) === null}
                    >
                      → Tarefa
                    </button>
                  )}
                  {commentTarget.linkedNoteId ? (
                    <button type="button" onClick={() => openLinked('note', commentTarget.linkedNoteId!)}>
                      Abrir nota ↗
                    </button>
                  ) : (
                    <button type="button" onClick={() => void convertFromEditor('note')}>
                      → Anotação
                    </button>
                  )}
                </>
              )}
              <button type="button" className="share-dialog-secondary" onClick={deleteCommentTarget}>
                Excluir
              </button>
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

// Preenche título/autores a partir da metadata do OPF (dc:title/dc:creator)
// na primeira abertura, quando o item ainda não tem autores cadastrados —
// diferente do PDF (que precisa escanear o texto atrás de um DOI), o EPUB já
// carrega essa informação estruturada.
async function autoFillMetadata(
  book: Book,
  uid: string,
  item: ReadingItem,
  onSyncFail: (message: string) => void,
): Promise<void> {
  try {
    const metadata = await book.loaded.metadata;
    const authors = authorsFromEpubCreator(metadata.creator);
    const patch: Partial<ReadingItem> = {};
    if (authors.length > 0) patch.authors = authors;
    if (metadata.title?.trim() && !item.title.trim()) patch.title = metadata.title.trim();
    if (metadata.publisher?.trim()) patch.publication = metadata.publisher.trim();
    const year = metadata.pubdate?.match(/\d{4}/)?.[0];
    if (year) patch.year = year;
    if (Object.keys(patch).length === 0) return;
    await patchReadingItem(uid, item.id, patch);
  } catch {
    onSyncFail('Não foi possível preencher os metadados automaticamente do EPUB.');
  }
}
