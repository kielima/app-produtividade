import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyMarkdownButton } from '../components/CopyMarkdownButton';
import { DepPicker } from '../components/DepPicker';
import { InlineEdit } from '../components/InlineEdit';
import { MarkdownNote } from '../components/MarkdownNote';
import { Popover } from '../components/Popover';
import { SubtaskList } from '../components/SubtaskList';
import { AiSubtasksError, generateSubtasks, hasGeminiApiKey } from '../lib/aiSubtasks';
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
  '': 'Sem MoSCoW',
};

const MODO_LABEL: Record<Modo, string> = {
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
};

const ESFORCO_LABEL: Record<Esforco, string> = {
  rapido: 'Rápido',
  medio: 'Médio',
  longo: 'Longo',
  '': 'Sem esforço',
};

type KanbanStatus = 'todo' | 'doing' | 'done';

const STATUS_LABEL: Record<KanbanStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluída',
};

const STATUS_OPTS: KanbanStatus[] = ['todo', 'doing', 'done'];
const MOSCOW_OPTS: MoSCoW[] = ['must', 'should', 'could', 'wont', ''];
const MODO_OPTS: Modo[] = ['manual', 'colaborar', 'delegar'];
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
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
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

  async function handleGenerateSubtasks() {
    setAiError(null);
    setAiLoading(true);
    try {
      const existing = task.subtasks.map((s) => s.text);
      const generated = await generateSubtasks({
        title: display,
        note: task.note,
        existingSubtasks: existing,
      });
      const existingNorm = new Set(existing.map((s) => s.toLowerCase()));
      const fresh = generated.filter((s) => !existingNorm.has(s.toLowerCase()));
      if (fresh.length === 0) {
        setAiError('A IA não sugeriu nada novo.');
        return;
      }
      await setSubtasks([
        ...task.subtasks,
        ...fresh.map((text) => ({ text, checked: false })),
      ]);
    } catch (e) {
      const msg =
        e instanceof AiSubtasksError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
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
  const currentMoscow: MoSCoW = task.moscow;
  const currentModo: Modo = task.modo;
  const currentEsforco: Esforco = task.esforco;
  const moscowClass = currentMoscow ? `moscow-${currentMoscow}` : 'moscow-none';
  const modoClass = `modo-${currentModo}`;
  const esforcoClass = currentEsforco ? `esforco-${currentEsforco}` : 'esforco-none';

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
          {task.addedDate ? `Adicionada em ${task.addedDate.replace(/^\d{2}(\d{2})/, '$1')}` : ''}
        </span>
        <span className="task-detail-topbar-right">
          <span className="badge score" title="score calculado">
            {score.toFixed(2)}
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
                className={`badge project${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {project?.name || task.section || 'Sem projeto'}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {projects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={p.id === task.section ? 'active' : ''}
                      onClick={() => {
                        moveToSection(p.id);
                        close();
                      }}
                    >
                      {p.name}
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
                className={`badge ${moscowClass}${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {MOSCOW_LABEL[currentMoscow]}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {MOSCOW_OPTS.map((v) => (
                  <li key={v || 'none'}>
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
                className={`badge ${modoClass}${isOpen ? ' open' : ''}`}
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
                className={`badge ${esforcoClass}${isOpen ? ' open' : ''}`}
                onClick={open}
              >
                {ESFORCO_LABEL[currentEsforco]}
              </button>
            )}
          >
            {(close) => (
              <ul className="picker-list">
                {ESFORCO_OPTS.map((v) => (
                  <li key={v || 'none'}>
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
              className="task-detail-deadline-input"
              value={task.deadline}
              onChange={(e) => setField('deadline', e.target.value)}
              tabIndex={-1}
              aria-hidden="true"
            />
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

        {task.dependsOn.length > 0 && (
          <dl className="task-detail-fields">
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
          </dl>
        )}

        <section className="task-detail-section">
          <div className="task-detail-section-header">
            <h3>Nota</h3>
            <CopyMarkdownButton value={task.note} ariaLabel="copiar nota em markdown" />
          </div>
          <MarkdownNote
            value={task.note}
            onSave={setNote}
            placeholder="(sem nota)"
          />
        </section>

        <section className="task-detail-section">
          <div className="task-detail-subtasks-header">
            <h3>
              Subtarefas{' '}
              {task.subtasks.length > 0 && (
                <span className="muted">
                  ({task.subtasks.filter((s) => s.checked).length}/{task.subtasks.length})
                </span>
              )}
            </h3>
            <button
              type="button"
              className="btn-ai-subtasks"
              onClick={handleGenerateSubtasks}
              disabled={aiLoading}
              title={
                hasGeminiApiKey()
                  ? 'Gerar subtarefas a partir do título e da nota'
                  : 'Configure a chave Gemini em Configurações primeiro'
              }
            >
              {aiLoading ? '⏳ Gerando…' : '✨ Gerar com IA'}
            </button>
          </div>
          {aiError && <p className="error task-detail-ai-error">{aiError}</p>}
          <SubtaskList subtasks={task.subtasks} onChange={setSubtasks} />
        </section>
      </div>

      {depModalOpen && (
        <DepPicker
          task={task}
          allTasks={allTasks}
          projects={projects}
          onClose={() => setDepModalOpen(false)}
          onChange={setDeps}
        />
      )}
    </section>
  );
}
