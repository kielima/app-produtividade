import { useEffect, useMemo, useState } from 'react';
import { DepPicker } from '../components/DepPicker';
import { InlineEdit } from '../components/InlineEdit';
import { SubtaskList } from '../components/SubtaskList';
import { getDisplayTitle } from '../lib/parser';
import { calcScore, isTaskBlocked } from '../lib/score';
import { patchTask } from '../lib/taskMutations';
import { deleteTask } from '../repositories/tasksRepo';
import type {
  Esforco,
  Modo,
  MoSCoW,
  Project,
  ScoreContext,
  Subtask,
  Task,
} from '../types';

const MOSCOW_LABEL: Record<MoSCoW, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
  '': '—',
};

const MODO_LABEL: Record<Modo, string> = {
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
  automatizar: 'Automatizar',
  '': '—',
};

const ESFORCO_LABEL: Record<Esforco, string> = {
  rapido: 'Rápido',
  medio: 'Médio',
  longo: 'Longo',
  '': '—',
};

type KanbanStatus = 'todo' | 'doing' | 'done';

const STATUS_LABEL: Record<KanbanStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluída',
};

const STATUS_OPTS: KanbanStatus[] = ['todo', 'doing', 'done'];
const MOSCOW_OPTS: MoSCoW[] = ['must', 'should', 'could', 'wont', ''];
const MODO_OPTS: Modo[] = ['manual', 'colaborar', 'delegar', 'automatizar', ''];
const ESFORCO_OPTS: Esforco[] = ['rapido', 'medio', 'longo', ''];

function taskStatus(task: Task): KanbanStatus {
  if (task.checked) return 'done';
  if (task.inProgress) return 'doing';
  return 'todo';
}

function statusPatch(status: KanbanStatus): Partial<Task> {
  if (status === 'todo') return { checked: false, inProgress: false };
  if (status === 'doing') return { checked: false, inProgress: true };
  return { checked: true, inProgress: false };
}

export function TaskDetailView({
  uid,
  task,
  allTasks,
  projects,
  projectMap,
  ctx,
  onClose,
}: {
  uid: string;
  task: Task;
  allTasks: Task[];
  projects: Project[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
  onClose: () => void;
}) {
  const display = getDisplayTitle(task.title);
  const [depModalOpen, setDepModalOpen] = useState(false);
  const blocked = isTaskBlocked(task, ctx);
  const score = useMemo(
    () => calcScore(task, projectMap[task.section] ?? null, ctx),
    [task, projectMap, ctx],
  );
  const project = projectMap[task.section];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !depModalOpen) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, depModalOpen]);

  async function setDisplay(newDisplay: string) {
    await patchTask(uid, task, {}, newDisplay);
  }

  async function setNote(newNote: string) {
    await patchTask(uid, task, { note: newNote });
  }

  async function setField<K extends keyof Task>(field: K, value: Task[K]) {
    await patchTask(uid, task, { [field]: value } as Partial<Task>);
  }

  async function setStatus(next: KanbanStatus) {
    await patchTask(uid, task, statusPatch(next));
  }

  async function setSubtasks(next: Subtask[]) {
    await patchTask(uid, task, { subtasks: next });
  }

  async function setDeps(next: string[]) {
    await patchTask(uid, task, { dependsOn: next });
  }

  async function moveToSection(newSectionId: string) {
    await patchTask(uid, task, { section: newSectionId });
  }

  async function handleDelete() {
    if (!window.confirm(`Apagar "${display}"?`)) return;
    await deleteTask(uid, task);
    onClose();
  }

  const status = taskStatus(task);

  return (
    <section className="task-detail">
      <header className="task-detail-header">
        <button
          type="button"
          className="icon-btn task-detail-back"
          onClick={onClose}
          aria-label="voltar"
        >
          ←
        </button>
        <span className="task-detail-id muted">
          {task.taskId != null ? `#${String(task.taskId).padStart(4, '0')}` : ''}
        </span>
      </header>

      <div className="task-detail-body">
        <div className="task-detail-title-row">
          <input
            type="checkbox"
            checked={task.checked}
            onChange={() => setStatus(task.checked ? 'todo' : 'done')}
            aria-label="alternar concluída"
            className="task-checkbox"
          />
          <InlineEdit
            value={display}
            onSave={setDisplay}
            className="task-detail-title"
            ariaLabel="editar título"
            multiline
          />
        </div>

        {blocked && (
          <p className="badge blocked task-detail-blocked">🔒 bloqueada por dependências</p>
        )}

        <dl className="task-detail-fields">
          <div className="task-detail-field">
            <dt>Score</dt>
            <dd>
              <span className="badge score">⚡ {score.toFixed(2)}</span>
            </dd>
          </div>

          <div className="task-detail-field">
            <dt>Status</dt>
            <dd>
              <div className="task-detail-options">
                {STATUS_OPTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`badge status-${v}${v === status ? ' active' : ''}`}
                    onClick={() => setStatus(v)}
                  >
                    {STATUS_LABEL[v]}
                  </button>
                ))}
              </div>
            </dd>
          </div>

          <div className="task-detail-field">
            <dt>Projeto</dt>
            <dd>
              <select
                className="task-detail-select"
                value={task.section}
                onChange={(e) => moveToSection(e.target.value)}
              >
                {projects.length === 0 && (
                  <option value={task.section}>{task.section || '—'}</option>
                )}
                {!projects.some((p) => p.id === task.section) && task.section && (
                  <option value={task.section}>{task.section}</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {project?.status && (
                <span className="muted task-detail-project-status">
                  &nbsp;· {project.status}
                </span>
              )}
            </dd>
          </div>

          <div className="task-detail-field">
            <dt>MoSCoW</dt>
            <dd>
              <div className="task-detail-options">
                {MOSCOW_OPTS.map((v) => (
                  <button
                    key={v || 'none'}
                    type="button"
                    className={`badge moscow-${v}${v === task.moscow ? ' active' : ''}`}
                    onClick={() => setField('moscow', v)}
                  >
                    {MOSCOW_LABEL[v]}
                  </button>
                ))}
              </div>
            </dd>
          </div>

          <div className="task-detail-field">
            <dt>Modo</dt>
            <dd>
              <div className="task-detail-options">
                {MODO_OPTS.map((v) => (
                  <button
                    key={v || 'none'}
                    type="button"
                    className={`badge modo-${v}${v === task.modo ? ' active' : ''}`}
                    onClick={() => setField('modo', v)}
                  >
                    {MODO_LABEL[v]}
                  </button>
                ))}
              </div>
            </dd>
          </div>

          <div className="task-detail-field">
            <dt>Esforço</dt>
            <dd>
              <div className="task-detail-options">
                {ESFORCO_OPTS.map((v) => (
                  <button
                    key={v || 'none'}
                    type="button"
                    className={`badge esforco-${v}${v === task.esforco ? ' active' : ''}`}
                    onClick={() => setField('esforco', v)}
                  >
                    {ESFORCO_LABEL[v]}
                  </button>
                ))}
              </div>
            </dd>
          </div>

          <div className="task-detail-field">
            <dt>Prazo</dt>
            <dd>
              <input
                type="date"
                className="task-detail-date"
                value={task.deadline}
                onChange={(e) => setField('deadline', e.target.value)}
              />
              {task.deadline && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setField('deadline', '')}
                >
                  limpar
                </button>
              )}
            </dd>
          </div>

          <div className="task-detail-field">
            <dt>Dependências</dt>
            <dd>
              <button
                type="button"
                className="badge dep"
                onClick={() => setDepModalOpen(true)}
              >
                🔗 {task.dependsOn.length || '—'}
              </button>
              {task.dependsOn.length > 0 && (
                <ul className="task-detail-deps">
                  {task.dependsOn.map((dep) => {
                    const m = dep.trim().match(/^#(\d+)$/);
                    const other = m
                      ? allTasks.find((t) => t.taskId === parseInt(m[1]!, 10))
                      : null;
                    return (
                      <li key={dep}>
                        <span className="dep-tag">{dep}</span>
                        {other && <span>&nbsp;— {getDisplayTitle(other.title)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </dd>
          </div>

          {task.addedDate && (
            <div className="task-detail-field">
              <dt>Adicionada em</dt>
              <dd className="muted">{task.addedDate}</dd>
            </div>
          )}
        </dl>

        <section className="task-detail-section">
          <h3>Nota</h3>
          <InlineEdit
            value={task.note}
            onSave={setNote}
            placeholder="(sem nota)"
            multiline
            className="task-detail-note"
          />
        </section>

        <section className="task-detail-section">
          <h3>
            Subtarefas{' '}
            {task.subtasks.length > 0 && (
              <span className="muted">
                ({task.subtasks.filter((s) => s.checked).length}/{task.subtasks.length})
              </span>
            )}
          </h3>
          <SubtaskList subtasks={task.subtasks} onChange={setSubtasks} />
        </section>

        <section className="task-detail-actions">
          <button
            type="button"
            className="link-btn danger"
            onClick={handleDelete}
          >
            Apagar tarefa
          </button>
        </section>
      </div>

      {depModalOpen && (
        <DepPicker
          task={task}
          allTasks={allTasks}
          onClose={() => setDepModalOpen(false)}
          onChange={setDeps}
        />
      )}
    </section>
  );
}
