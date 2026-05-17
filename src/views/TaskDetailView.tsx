import { useEffect, useMemo, useRef, useState } from 'react';
import { DepPicker } from '../components/DepPicker';
import { InlineEdit } from '../components/InlineEdit';
import { Popover } from '../components/Popover';
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

const MOSCOW_LABEL: Record<Exclude<MoSCoW, ''>, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
};

const MODO_LABEL: Record<Exclude<Modo, ''>, string> = {
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
  automatizar: 'Automatizar',
};

const ESFORCO_LABEL: Record<Exclude<Esforco, ''>, string> = {
  rapido: 'Rápido',
  medio: 'Médio',
  longo: 'Longo',
};

type KanbanStatus = 'todo' | 'doing' | 'done';

const STATUS_LABEL: Record<KanbanStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluída',
};

const STATUS_OPTS: KanbanStatus[] = ['todo', 'doing', 'done'];
const MOSCOW_OPTS: Array<Exclude<MoSCoW, ''>> = ['must', 'should', 'could', 'wont'];
const MODO_OPTS: Array<Exclude<Modo, ''>> = ['manual', 'colaborar', 'delegar', 'automatizar'];
const ESFORCO_OPTS: Array<Exclude<Esforco, ''>> = ['rapido', 'medio', 'longo'];

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
  const deadlineInputRef = useRef<HTMLInputElement>(null);
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

  async function handleDelete() {
    if (!window.confirm(`Apagar "${display}"?`)) return;
    await deleteTask(uid, task);
    onClose();
  }

  const status = taskStatus(task);
  const currentMoscow: Exclude<MoSCoW, ''> = task.moscow || 'wont';
  const currentModo: Exclude<Modo, ''> = task.modo || 'manual';
  const currentEsforco: Exclude<Esforco, ''> = task.esforco || 'longo';

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
          {task.addedDate ? `Adicionada em ${task.addedDate}` : ''}
        </span>
        <span className="task-detail-topbar-right">
          <span className="badge score" title="score calculado">
            ⚡ {score.toFixed(2)}
          </span>
          <button
            type="button"
            className="task-detail-delete"
            onClick={handleDelete}
            aria-label="apagar tarefa"
            title="apagar tarefa"
          >
            ×
          </button>
        </span>
      </header>

      <div className="task-detail-body">
        <div className="task-detail-title-row">
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

        <div className="task-detail-badges">
          <Popover
            trigger={(open, isOpen) => (
              <button
                type="button"
                className={`badge status-${status}${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {STATUS_LABEL[status]}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {STATUS_OPTS.map((v) => (
                  <li key={v}>
                    <button
                      type="button"
                      className={v === status ? 'active' : ''}
                      onClick={() => {
                        setStatus(v);
                        close();
                      }}
                    >
                      {STATUS_LABEL[v]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>

          <Popover
            trigger={(open, isOpen) => (
              <button
                type="button"
                className={`badge moscow-${currentMoscow}${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {MOSCOW_LABEL[currentMoscow]}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {MOSCOW_OPTS.map((v) => (
                  <li key={v}>
                    <button
                      type="button"
                      className={v === currentMoscow ? 'active' : ''}
                      onClick={() => {
                        setField('moscow', v);
                        close();
                      }}
                    >
                      {MOSCOW_LABEL[v]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>

          <Popover
            trigger={(open, isOpen) => (
              <button
                type="button"
                className={`badge modo-${currentModo}${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {MODO_LABEL[currentModo]}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {MODO_OPTS.map((v) => (
                  <li key={v}>
                    <button
                      type="button"
                      className={v === currentModo ? 'active' : ''}
                      onClick={() => {
                        setField('modo', v);
                        close();
                      }}
                    >
                      {MODO_LABEL[v]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>

          <Popover
            trigger={(open, isOpen) => (
              <button
                type="button"
                className={`badge esforco-${currentEsforco}${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {ESFORCO_LABEL[currentEsforco]}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {ESFORCO_OPTS.map((v) => (
                  <li key={v}>
                    <button
                      type="button"
                      className={v === currentEsforco ? 'active' : ''}
                      onClick={() => {
                        setField('esforco', v);
                        close();
                      }}
                    >
                      {ESFORCO_LABEL[v]}
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
              {task.deadline || 'Data'}
            </button>
            <input
              ref={deadlineInputRef}
              type="date"
              className="sr-only task-detail-deadline-input"
              value={task.deadline}
              onChange={(e) => setField('deadline', e.target.value)}
              tabIndex={-1}
              aria-hidden="true"
            />
            {task.deadline && (
              <button
                type="button"
                className="badge deadline-clear"
                onClick={() => setField('deadline', '')}
                aria-label="limpar prazo"
                title="limpar prazo"
              >
                ×
              </button>
            )}
          </span>

          <button
            type="button"
            className="badge dep"
            onClick={() => setDepModalOpen(true)}
            aria-label="dependências"
          >
            🔗 {task.dependsOn.length || '—'}
          </button>
        </div>

        <dl className="task-detail-fields">
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

          {task.dependsOn.length > 0 && (
            <div className="task-detail-field">
              <dt>Dependências</dt>
              <dd>
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
              </dd>
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
