import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NoteContentState } from '../lib/obsidianTreeState';
import { stripMdExtension } from '../lib/obsidianWikilink';

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.2;
const ZOOM_STEP = 0.15;

// "Espiar" uma nota a partir do grafo — leitura, não edição (spec: clicar num
// nó de nota é um preview, só "Editar" promove pra edição de verdade,
// trocando pro modo árvore). Ocupa o lugar do grafo (não é mais uma janela
// flutuante) como uma mini página, com zoom por tamanho de fonte — mais
// simples e mais previsível pro scroll do que um `transform: scale()`, que
// exigiria recalcular a altura do contêiner rolável manualmente.
export function ObsidianNotePreviewPage({
  name,
  note,
  onClose,
  onEdit,
}: {
  name: string;
  note: NoteContentState | undefined;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [zoom, setZoom] = useState(1);

  return (
    <div className="obsidian-note-page-view" role="dialog" aria-label={`Preview de ${name}`}>
      <div className="obsidian-note-page-header">
        <strong>{stripMdExtension(name)}</strong>
        <button type="button" className="obsidian-note-page-close" onClick={onClose} aria-label="Fechar preview">
          ×
        </button>
      </div>

      <div className="obsidian-note-page-scroll">
        <div className="obsidian-note-page" style={{ fontSize: `${zoom}rem` }}>
          {(!note || note.status === 'loading') && <p className="muted">Carregando…</p>}
          {note?.status === 'error' && <p className="error">{note.error}</p>}
          {note && (note.status === 'loaded' || note.status === 'saving') && (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content || '(nota vazia)'}</ReactMarkdown>
          )}
        </div>
      </div>

      <div className="obsidian-note-page-controls">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
          aria-label="Aumentar texto"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
          aria-label="Diminuir texto"
        >
          −
        </button>
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Editar
        </button>
      </div>
    </div>
  );
}
