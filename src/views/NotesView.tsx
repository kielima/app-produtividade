import { useMemo, useState } from 'react';
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

export function NotesView({ uid, notes }: { uid: string; notes: Note[] }) {
  const { openNote } = useNoteNavigation();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) {
      for (const tag of n.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (selectedTags.length === 0) return notes;
    const required = new Set(selectedTags);
    return notes.filter((n) => {
      const noteTags = new Set(n.tags);
      for (const t of required) if (!noteTags.has(t)) return false;
      return true;
    });
  }, [notes, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <>
      {allTags.length > 0 && (
        <div className="notes-tags-filter" role="group" aria-label="filtrar por tags">
          {allTags.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`tag-chip tag-chip-toggle${active ? ' active' : ''}`}
                onClick={() => toggleTag(tag)}
                aria-pressed={active}
              >
                {tag}
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <button
              type="button"
              className="btn-link notes-tags-clear"
              onClick={() => setSelectedTags([])}
            >
              limpar
            </button>
          )}
        </div>
      )}
      {filteredNotes.length === 0 ? (
        <p className="muted notes-empty">
          {notes.length === 0
            ? 'Nenhuma anotação ainda. Toque em + para criar.'
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
