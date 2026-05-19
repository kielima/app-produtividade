import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NewNoteFab } from '../components/NewNoteFab';
import { useNoteNavigation } from '../lib/noteNavigation';
import type { Note } from '../types';

function NoteCard({ note, onClick }: { note: Note; onClick: () => void }) {
  const hasItems = note.items.length > 0;
  const checkedCount = note.items.filter((i) => i.checked).length;

  return (
    <article
      className="note-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <p className="note-card-title">
        {note.title || <span className="muted">(sem título)</span>}
      </p>
      {note.note && (
        <div className="note-card-preview markdown-note-preview">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.note}</ReactMarkdown>
        </div>
      )}
      {hasItems && (
        <p className="note-card-items muted">
          Lista: {checkedCount}/{note.items.length}
        </p>
      )}
      {note.tags.length > 0 && (
        <div className="note-card-tags">
          {note.tags.map((tag) => (
            <span key={tag} className="tag-chip tag-chip-static">
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export function NotesView({
  uid,
  notes,
  selectedTags,
  searchQuery,
}: {
  uid: string;
  notes: Note[];
  selectedTags: string[];
  searchQuery: string;
}) {
  const { openNote } = useNoteNavigation();

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const required = selectedTags.length > 0 ? new Set(selectedTags) : null;
    if (!q && !required) return notes;
    return notes.filter((n) => {
      if (required) {
        const noteTags = new Set(n.tags);
        for (const t of required) if (!noteTags.has(t)) return false;
      }
      if (q) {
        const haystack = [
          n.title,
          n.note,
          ...n.items.map((i) => i.text),
          ...n.tags,
        ]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [notes, selectedTags, searchQuery]);

  const hasSearch = searchQuery.trim().length > 0;

  return (
    <>
      {filteredNotes.length === 0 ? (
        <p className="muted notes-empty">
          {notes.length === 0
            ? 'Nenhuma anotação ainda. Toque em + para criar.'
            : hasSearch
              ? 'Nenhuma anotação corresponde à pesquisa.'
              : 'Nenhuma anotação corresponde às tags selecionadas.'}
        </p>
      ) : (
        <div className="note-list">
          {filteredNotes.map((n) => (
            <NoteCard key={n.id} note={n} onClick={() => openNote(n.id)} />
          ))}
        </div>
      )}
      <NewNoteFab uid={uid} />
    </>
  );
}
