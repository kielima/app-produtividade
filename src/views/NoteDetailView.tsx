import { useEffect, useState } from 'react';
import { InlineEdit } from '../components/InlineEdit';
import { MarkdownNote } from '../components/MarkdownNote';
import { SubtaskList } from '../components/SubtaskList';
import { TagsEditor } from '../components/TagsEditor';
import { serializeTitle } from '../lib/parser';
import { normalizeTags } from '../lib/tags';
import { deleteNote, patchNote } from '../repositories/notesRepo';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
import type { Note, Project, Subtask, Task } from '../types';

function isHiddenProject(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

export function NoteDetailView({
  uid,
  note,
  allTags = [],
  projects = [],
  onConvertedToTask,
  onClose,
}: {
  uid: string;
  note: Note;
  allTags?: string[];
  projects?: Project[];
  onConvertedToTask?: (taskId: string) => void;
  onClose: () => void;
}) {
  const [converting, setConverting] = useState(false);
  const availableProjects = projects.filter((p) => !isHiddenProject(p));
  const canConvert = availableProjects.length > 0;
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

  async function setTags(tags: string[]) {
    await patchNote(uid, note.id, { tags: normalizeTags(tags) });
  }

  async function handleDelete() {
    if (!window.confirm(`Apagar "${note.title || 'esta anotação'}"?`)) return;
    await deleteNote(uid, note.id);
    onClose();
  }

  async function handleConvertToTask() {
    if (converting || !canConvert) return;
    if (
      !window.confirm(
        `Transformar "${note.title || 'esta anotação'}" em tarefa? A anotação será removida.`,
      )
    ) {
      return;
    }
    setConverting(true);
    try {
      const taskId = await nextTaskId(uid);
      const today = new Date().toISOString().slice(0, 10);
      const addedDate = note.addedDate || today;
      const sectionId = availableProjects[0]!.id;
      const newTask: Task = {
        id: String(taskId),
        taskId,
        title: serializeTitle(note.title, {
          taskId,
          modo: 'manual',
          moscow: '',
          esforco: '',
          deadline: '',
          addedDate,
          dependsOn: [],
        }),
        note: note.note,
        checked: false,
        inProgress: false,
        moscow: '',
        modo: 'manual',
        esforco: '',
        deadline: '',
        addedDate,
        dependsOn: [],
        subtasks: note.items.map((s) => ({ text: s.text, checked: s.checked })),
        section: sectionId,
      };
      await upsertTask(uid, newTask);
      await deleteNote(uid, note.id);
      if (onConvertedToTask) onConvertedToTask(String(taskId));
      else onClose();
    } finally {
      setConverting(false);
    }
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
          <MarkdownNote
            value={note.note}
            onSave={setNoteText}
            placeholder="(sem nota)"
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

        <section className="task-detail-section">
          <h3>Tags</h3>
          <TagsEditor
            tags={note.tags}
            onChange={setTags}
            suggestions={allTags}
          />
        </section>

        <div className="note-detail-actions">
          <button
            type="button"
            className="btn-secondary note-detail-convert"
            onClick={handleConvertToTask}
            disabled={converting || !canConvert}
            title={
              !canConvert
                ? 'Crie um projeto antes de transformar em tarefa'
                : 'Transformar esta anotação em tarefa'
            }
          >
            {converting ? 'Transformando…' : 'Transformar em tarefa'}
          </button>
        </div>
      </div>
    </section>
  );
}
