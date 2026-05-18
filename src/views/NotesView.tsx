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
      {note.note && <p className="note-card-preview">{note.note}</p>}
      {hasItems && (
        <p className="note-card-items muted">
          Lista: {checkedCount}/{note.items.length}
        </p>
      )}
    </article>
  );
}

export function NotesView({ uid, notes }: { uid: string; notes: Note[] }) {
  const { openNote } = useNoteNavigation();

  return (
    <>
      {notes.length === 0 ? (
        <p className="muted notes-empty">Nenhuma anotação ainda. Toque em + para criar.</p>
      ) : (
        <div className="note-list">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} onClick={() => openNote(n.id)} />
          ))}
        </div>
      )}
      <NewNoteFab uid={uid} />
    </>
  );
}
