import { useEffect, useRef, useState } from 'react';
import { InlineEdit } from '../components/InlineEdit';
import { Popover } from '../components/Popover';
import { ProjectDepPicker } from '../components/ProjectDepPicker';
import TrashIcon from '../components/TrashIcon';
import { useNoteNavigation } from '../lib/noteNavigation';
import {
  deleteProjectWithTasks,
  patchProject,
} from '../repositories/projectsRepo';
import type { Note, Project, ProjectStatus } from '../types';

const STATUS_OPTS: ProjectStatus[] = [
  'A iniciar',
  'Em planejamento',
  'Em andamento',
  'Pausado',
  'Concluído',
  'Cancelado',
];

const STATUS_LABEL: Record<ProjectStatus, string> = {
  'A iniciar': 'A iniciar',
  'Em planejamento': 'Em planejamento',
  'Em andamento': 'Em andamento',
  Pausado: 'Pausado',
  'Concluído': 'Concluído',
  Cancelado: 'Cancelado',
};

const STATUS_SLUG: Record<ProjectStatus, string> = {
  'A iniciar': 'a-iniciar',
  'Em planejamento': 'em-planejamento',
  'Em andamento': 'em-andamento',
  Pausado: 'pausado',
  'Concluído': 'concluido',
  Cancelado: 'cancelado',
};

export function ProjectDetailView({
  uid,
  project,
  allProjects,
  taskCount,
  score,
  notes = [],
  onClose,
}: {
  uid: string;
  project: Project;
  allProjects: Project[];
  taskCount: number;
  score?: number;
  notes?: Note[];
  onClose: () => void;
}) {
  const { openNote } = useNoteNavigation();
  const deadlineInputRef = useRef<HTMLInputElement>(null);
  const [depPickerOpen, setDepPickerOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function patch(field: keyof Project, value: string | null) {
    await patchProject(uid, project.id, { [field]: value } as Partial<Project>);
  }

  async function handleDelete() {
    if (!window.confirm(`Apagar o projeto "${project.name}" e todas as tarefas dentro dele?`)) {
      return;
    }
    await deleteProjectWithTasks(uid, project.id);
    onClose();
  }

  function openDatePicker() {
    const input = deadlineInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  }

  const statusClass = STATUS_SLUG[project.status];

  return (
    <section className="task-detail project-detail">
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
          {taskCount} tarefa{taskCount === 1 ? '' : 's'}
        </span>
        <span className="task-detail-topbar-right">
          {typeof score === 'number' && (
            <span className="badge score" title="pontuação derivada da posição na lista">
              {score.toFixed(2)}
            </span>
          )}
          <button
            type="button"
            className="task-detail-delete"
            onClick={handleDelete}
            aria-label="apagar projeto"
            title="apagar projeto"
          >
            <TrashIcon size={22} />
          </button>
        </span>
      </header>

      <div className="task-detail-body">
        <div className="task-detail-title-row">
          <InlineEdit
            value={project.name}
            onSave={(v) => patch('name', v)}
            className="task-detail-title"
            ariaLabel="editar nome do projeto"
          />
        </div>

        <div className="task-detail-badges">
          <Popover
            trigger={(open, isOpen) => (
              <button
                type="button"
                className={`badge status-${statusClass}${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {STATUS_LABEL[project.status]}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {STATUS_OPTS.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className={s === project.status ? 'active' : ''}
                      onClick={() => {
                        patch('status', s);
                        close();
                      }}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>

          <span className="task-detail-deadline-wrap">
            <button
              type="button"
              className="badge deadline"
              onClick={openDatePicker}
            >
              {project.deadline || 'Prazo'}
            </button>
            <input
              ref={deadlineInputRef}
              type="date"
              className="task-detail-deadline-input"
              value={project.deadline}
              onChange={(e) => patch('deadline', e.target.value)}
              tabIndex={-1}
              aria-hidden="true"
            />
          </span>
        </div>

        <dl className="task-detail-fields">
          <Field
            label="Área"
            value={project.area}
            onSave={(v) => patch('area', v)}
            placeholder="(área temática)"
          />
          <Field
            label="🏷️ Categoria"
            value={project.category}
            onSave={(v) => patch('category', v)}
            placeholder="(categoria para agrupar)"
          />
          <Field
            label="🎯 Objetivo"
            value={project.objective}
            onSave={(v) => patch('objective', v)}
            placeholder="(objetivo do projeto)"
            multiline
          />
          <Field
            label="📌 Status atual"
            value={project.currentStatus}
            onSave={(v) => patch('currentStatus', v)}
            placeholder="(onde está hoje)"
            multiline
          />
          <Field
            label="➡️ Próximos passos"
            value={project.nextSteps}
            onSave={(v) => patch('nextSteps', v)}
            placeholder="(o que fazer a seguir)"
            multiline
          />
          <Field
            label="⏱️ Duração estimada"
            value={project.estimatedDuration}
            onSave={(v) => patch('estimatedDuration', v)}
            placeholder="(ex: 3 meses)"
          />
          <div className="task-detail-field">
            <dt>🔗 Depende de</dt>
            <dd>
              <button
                type="button"
                className={`badge dep-project-badge${project.dependsOn ? ' has-dep' : ''}`}
                onClick={() => setDepPickerOpen(true)}
                title="Selecionar projeto bloqueante"
              >
                {project.dependsOn
                  ? (allProjects.find((p) => p.id === project.dependsOn)?.name ?? project.dependsOn)
                  : '(nenhum)'}
              </button>
            </dd>
          </div>
        </dl>

        <section className="task-detail-section">
          <h3>📝 Notas</h3>
          <InlineEdit
            value={project.notes}
            onSave={(v) => patch('notes', v)}
            placeholder="(notas livres)"
            multiline
            className="task-detail-note"
          />
        </section>

        {notes.length > 0 && (
          <section className="task-detail-section">
            <h3>🗒️ Anotações do Keep ({notes.length})</h3>
            <ul className="project-detail-notes-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="project-detail-note-item"
                    onClick={() => openNote(n.id)}
                  >
                    <span className="project-detail-note-title">
                      {n.title || <span className="muted">(sem título)</span>}
                    </span>
                    {n.tags.length > 0 && (
                      <span className="project-detail-note-tags">
                        {n.tags.map((t) => (
                          <span key={t} className="tag-chip tag-chip-static tag-chip-xs">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {depPickerOpen && (
        <ProjectDepPicker
          currentProject={project}
          allProjects={allProjects}
          onClose={() => setDepPickerOpen(false)}
          onChange={(id) => patch('dependsOn', id)}
        />
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onSave,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <div className="task-detail-field">
      <dt>{label}</dt>
      <dd>
        <InlineEdit
          value={value}
          onSave={onSave}
          placeholder={placeholder}
          multiline={multiline}
        />
      </dd>
    </div>
  );
}
