import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NoteContentState } from '../lib/obsidianTreeState';
import { stripMdExtension } from '../lib/obsidianWikilink';

// Painel flutuante de "espiar" uma nota a partir do grafo — leitura, não
// edição (spec: clicar num nó de nota no grafo é um preview, não abre o
// editor). Só a ação explícita "Editar" promove pra edição de verdade,
// trocando pro modo árvore com a nota selecionada.
export function ObsidianNotePreviewOverlay({
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
  return (
    <div className="obsidian-note-preview-overlay" role="dialog" aria-label={`Preview de ${name}`}>
      <div className="obsidian-note-preview-header">
        <strong>{stripMdExtension(name)}</strong>
        <button type="button" className="obsidian-note-preview-close" onClick={onClose} aria-label="Fechar preview">
          ×
        </button>
      </div>
      <div className="obsidian-note-preview-body">
        {(!note || note.status === 'loading') && <p className="muted">Carregando…</p>}
        {note?.status === 'error' && <p className="error">{note.error}</p>}
        {note && (note.status === 'loaded' || note.status === 'saving') && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content || '(nota vazia)'}</ReactMarkdown>
        )}
      </div>
      <div className="obsidian-note-preview-actions">
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Editar
        </button>
      </div>
    </div>
  );
}
