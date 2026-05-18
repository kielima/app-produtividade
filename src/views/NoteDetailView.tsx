import { useEffect } from 'react';
import { InlineEdit } from '../components/InlineEdit';
import { SubtaskList } from '../components/SubtaskList';
import { deleteNote, patchNote } from '../repositories/notesRepo';
import type { Note, Subtask } from '../types';

export function NoteDetailView({
  uid,
  note,
  onClose,
}: {
  uid: string;
  note: Note;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function setTitle(value: string) {
    await patchNote(uid, note.id, { title: value });
  }

  async function setNoteText(value: string) {
    await patchNote(uid, note.id, { note: value });
  }

  async function setItems(items: Subtask[]) {
    await patchNote(uid, note.id, { items });
  }

  async function handleDelete() {
    if (!window.confirm(`Apagar "${note.title || 'esta anotação'}"?`)) return;
    await deleteNote(uid, note.id);
    onClose();
  }

  return (
    <section className="task-detail">
      <header className="topbar task-detail-topbar" role="banner">
        <button
          type="button"
          className="menu-toggle"
          onClick={onClose}
          aria-label="voltar"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="muted task-detail-added">
          {note.addedDate
            ? `Criada em ${note.addedDate.replace(/^\d{2}(\d{2})/, '$1')}`
            : ''}
        </span>
        <span className="task-detail-topbar-right">
          <button
            type="button"
            className="task-detail-delete"
            onClick={handleDelete}
            aria-label="apagar anotação"
            title="apagar anotação"
          >
            ×
          </button>
        </span>
      </header>

      <div className="task-detail-body">
        <div className="task-detail-title-row">
          <InlineEdit
            value={note.title}
            onSave={setTitle}
            className="task-detail-title"
            ariaLabel="editar título"
            placeholder="(sem título)"
            multiline
          />
        </div>

        <section className="task-detail-section">
          <h3>Nota</h3>
          <InlineEdit
            value={note.note}
            onSave={setNoteText}
            placeholder="(sem nota)"
            multiline
            className="task-detail-note"
          />
        </section>

        <section className="task-detail-section">
          <h3>
            Lista{' '}
            {note.items.length > 0 && (
              <span className="muted">
                ({note.items.filter((s) => s.checked).length}/{note.items.length})
              </span>
            )}
          </h3>
          <SubtaskList subtasks={note.items} onChange={setItems} />
        </section>
      </div>
    </section>
  );
}
