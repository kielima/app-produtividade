import { useState } from 'react';
import { deleteProjectWithTasks, patchProject } from '../repositories/projectsRepo';
import type { Project, ProjectStatus } from '../types';
import { InlineEdit } from './InlineEdit';
import { Popover } from './Popover';

const STATUS_OPTS: ProjectStatus[] = [
  'A iniciar',
  'Em andamento',
  'Pausado',
  'Concluído',
  'Cancelado',
];

const STATUS_LABEL: Record<ProjectStatus, string> = {
  'A iniciar': 'A iniciar',
  'Em andamento': 'Em andamento',
  Pausado: 'Pausado',
  'Concluído': 'Concluído',
  Cancelado: 'Cancelado',
};

const STATUS_SLUG: Record<ProjectStatus, string> = {
  'A iniciar': 'a-iniciar',
  'Em andamento': 'em-andamento',
  Pausado: 'pausado',
  'Concluído': 'concluido',
  Cancelado: 'cancelado',
};

export function ProjectCard({
  uid,
  project,
  taskCount,
  score,
}: {
  uid: string;
  project: Project;
  taskCount: number;
  score?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  async function patch(field: keyof Project, value: string) {
    await patchProject(uid, project.id, { [field]: value } as Partial<Project>);
  }

  async function handleDelete() {
    if (!window.confirm(`Apagar o projeto "${project.name}" e todas as tarefas dentro dele?`)) {
      return;
    }
    await deleteProjectWithTasks(uid, project.id);
  }

  const statusClass = STATUS_SLUG[project.status];
  const isDone = project.status === 'Concluído' || project.status === 'Cancelado';

  return (
    <article className={`project-card${isDone ? ' done' : ''}`}>
      <header className="project-head">
        <InlineEdit
          value={project.name}
          onSave={(v) => patch('name', v)}
          className="project-name"
          ariaLabel="editar nome do projeto"
        />

        <span className="muted project-task-count">
          {taskCount} tarefa{taskCount === 1 ? '' : 's'}
        </span>

        <button
          type="button"
          className="icon-btn project-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'recolher' : 'expandir'}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <button
          type="button"
          className="icon-btn danger"
          onClick={handleDelete}
          aria-label="apagar projeto"
          title="apagar projeto"
        >
          🗑
        </button>
      </header>

      <div className="project-badges">
        {typeof score === 'number' && (
          <span className="badge score" title="pontuação derivada da posição na lista (curva gaussiana)">
            ⚡ {score.toFixed(2)}
          </span>
        )}
        <Popover
          trigger={(open) => (
            <button type="button" className={`badge status-${statusClass}`} onClick={open}>
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

      </div>

      {project.objective && (
        <p className="project-line">
          <span className="muted">🎯</span> {project.objective}
        </p>
      )}

      {expanded && (
        <div className="project-body">
          <Field
            label="Área"
            value={project.area}
            onSave={(v) => patch('area', v)}
            placeholder="(área temática)"
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
          <div className="project-row">
            <label>
              <span className="muted">📅 Prazo:</span>&nbsp;
              <input
                type="date"
                value={project.deadline}
                onChange={(e) => patch('deadline', e.target.value)}
              />
            </label>
            <Field
              label="⏱️ Duração estimada"
              value={project.estimatedDuration}
              onSave={(v) => patch('estimatedDuration', v)}
              placeholder="(ex: 3 meses)"
              inline
            />
          </div>
          <Field
            label="🔗 Depende de"
            value={project.dependsOn}
            onSave={(v) => patch('dependsOn', v)}
            placeholder="(outro projeto, opcional)"
          />
          <Field
            label="📝 Notas"
            value={project.notes}
            onSave={(v) => patch('notes', v)}
            placeholder="(notas livres)"
            multiline
          />
        </div>
      )}
    </article>
  );
}

function Field({
  label,
  value,
  onSave,
  placeholder,
  multiline,
  inline,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  inline?: boolean;
}) {
  return (
    <div className={`project-field${inline ? ' inline' : ''}`}>
      <span className="project-field-label">{label}:</span>
      <InlineEdit
        value={value}
        onSave={onSave}
        placeholder={placeholder}
        multiline={multiline}
        className="project-field-value"
      />
    </div>
  );
}
