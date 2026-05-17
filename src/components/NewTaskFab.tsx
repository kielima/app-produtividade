import { useEffect, useMemo, useState } from 'react';
import { serializeTitle } from '../lib/parser';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
import type { Project, Task } from '../types';

function isHiddenProject(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

export function NewTaskFab({
  uid,
  projects,
  defaultProjectId,
}: {
  uid: string;
  projects: Project[];
  defaultProjectId: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [saving, setSaving] = useState(false);

  const availableProjects = useMemo(
    () => projects.filter((p) => !isHiddenProject(p)),
    [projects],
  );

  useEffect(() => {
    if (!open) return;
    const fallback = availableProjects[0]?.id ?? '';
    const initial =
      defaultProjectId && availableProjects.some((p) => p.id === defaultProjectId)
        ? defaultProjectId
        : fallback;
    setSectionId(initial);
    setTitle('');
  }, [open, defaultProjectId, availableProjects]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function submit() {
    const text = title.trim();
    if (!text || !sectionId || saving) return;
    setSaving(true);
    try {
      const taskId = await nextTaskId(uid);
      const today = new Date().toISOString().slice(0, 10);
      const newTask: Task = {
        id: String(taskId),
        taskId,
        title: serializeTitle(text, {
          taskId,
          modo: '',
          moscow: '',
          esforco: '',
          deadline: '',
          addedDate: today,
          dependsOn: [],
        }),
        note: '',
        checked: false,
        inProgress: false,
        moscow: '',
        modo: '',
        esforco: '',
        deadline: '',
        addedDate: today,
        dependsOn: [],
        subtasks: [],
        section: sectionId,
      };
      await upsertTask(uid, newTask);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="fab"
        onClick={() => setOpen(true)}
        aria-label="adicionar tarefa"
        title="adicionar tarefa"
      >
        +
      </button>
      {open && (
        <div
          className="modal-backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Nova tarefa"
          >
            <header className="modal-header">
              <h3>Nova tarefa</h3>
              <button
                onClick={() => setOpen(false)}
                className="icon-btn"
                aria-label="fechar"
              >
                ×
              </button>
            </header>

            <section className="new-task-modal-body">
              <label className="new-task-modal-field">
                <span>Título</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                  placeholder="Descreva a tarefa…"
                  autoFocus
                  disabled={saving}
                  className="inline-edit-input"
                />
              </label>

              <label className="new-task-modal-field">
                <span>Projeto</span>
                {availableProjects.length === 0 ? (
                  <p className="muted">
                    Crie um projeto antes de adicionar uma tarefa.
                  </p>
                ) : (
                  <select
                    value={sectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                    disabled={saving}
                    className="inline-edit-input"
                  >
                    {availableProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </section>

            <footer className="new-task-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={
                  saving || !title.trim() || !sectionId || availableProjects.length === 0
                }
              >
                Adicionar
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
