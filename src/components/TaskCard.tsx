import { useState } from 'react';
import { getDisplayTitle } from '../lib/parser';
import { patchTask } from '../lib/taskMutations';
import { deleteTask } from '../repositories/tasksRepo';
import type { Esforco, Modo, MoSCoW, Project, Subtask, Task } from '../types';
import { DepPicker } from './DepPicker';
import { InlineEdit } from './InlineEdit';
import { Popover } from './Popover';
import { SubtaskList } from './SubtaskList';

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

const MOSCOW_OPTS: MoSCoW[] = ['must', 'should', 'could', 'wont', ''];
const MODO_OPTS: Modo[] = ['manual', 'colaborar', 'delegar', 'automatizar', ''];
const ESFORCO_OPTS: Esforco[] = ['rapido', 'medio', 'longo', ''];

export function TaskCard({
  uid,
  task,
  blocked,
  projects,
  allTasks,
  score,
}: {
  uid: string;
  task: Task;
  blocked: boolean;
  projects: Project[];
  allTasks: Task[];
  score?: number;
}) {
  const display = getDisplayTitle(task.title);
  const [expanded, setExpanded] = useState(false);
  const [depModalOpen, setDepModalOpen] = useState(false);

  async function toggleChecked() {
    await patchTask(uid, task, { checked: !task.checked });
  }

  async function setDisplay(newDisplay: string) {
    await patchTask(uid, task, {}, newDisplay);
  }

  async function setNote(newNote: string) {
    await patchTask(uid, task, { note: newNote });
  }

  async function setField<K extends keyof Task>(field: K, value: Task[K]) {
    await patchTask(uid, task, { [field]: value } as Partial<Task>);
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
  }

  return (
    <article className={`task-card${blocked ? ' dep-blocked' : ''}${task.checked ? ' done' : ''}`}>
      <div className="task-line">
        <input
          type="checkbox"
          checked={task.checked}
          onChange={toggleChecked}
          aria-label="alternar concluída"
          className="task-checkbox"
        />
        <InlineEdit
          value={display}
          onSave={setDisplay}
          className="task-title"
          ariaLabel="editar título"
        />
        <button
          type="button"
          className="icon-btn task-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'recolher' : 'expandir'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      <div className="task-badges">
        {typeof score === 'number' && (
          <span className="badge score" title="score calculado">
            ⚡ {score.toFixed(2)}
          </span>
        )}
        <Popover
          trigger={(open, isOpen) => (
            <button
              type="button"
              className={`badge moscow-${task.moscow}${isOpen ? ' open' : ''}`}
              onClick={open}
            >
              {MOSCOW_LABEL[task.moscow]}
            </button>
          )}
        >
          {(close) => (
            <ul className="picker-list">
              {MOSCOW_OPTS.map((v) => (
                <li key={v}>
                  <button
                    type="button"
                    className={v === task.moscow ? 'active' : ''}
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
          trigger={(open) => (
            <button type="button" className={`badge modo-${task.modo}`} onClick={open}>
              {MODO_LABEL[task.modo]}
            </button>
          )}
        >
          {(close) => (
            <ul className="picker-list">
              {MODO_OPTS.map((v) => (
                <li key={v}>
                  <button
                    type="button"
                    className={v === task.modo ? 'active' : ''}
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
          trigger={(open) => (
            <button type="button" className={`badge esforco-${task.esforco}`} onClick={open}>
              {ESFORCO_LABEL[task.esforco]}
            </button>
          )}
        >
          {(close) => (
            <ul className="picker-list">
              {ESFORCO_OPTS.map((v) => (
                <li key={v}>
                  <button
                    type="button"
                    className={v === task.esforco ? 'active' : ''}
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

        <Popover
          trigger={(open) => (
            <button type="button" className="badge deadline" onClick={open}>
              📅 {task.deadline || 'sem prazo'}
            </button>
          )}
        >
          {(close) => (
            <div className="picker-date">
              <input
                type="date"
                value={task.deadline}
                onChange={(e) => setField('deadline', e.target.value)}
              />
              <div className="picker-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setField('deadline', '');
                    close();
                  }}
                >
                  limpar
                </button>
                <button type="button" className="link-btn" onClick={close}>
                  ok
                </button>
              </div>
            </div>
          )}
        </Popover>

        <button type="button" className="badge dep" onClick={() => setDepModalOpen(true)}>
          🔗 {task.dependsOn.length || '—'}
        </button>

        {blocked && <span className="badge blocked">🔒 bloqueada</span>}

        <Popover
          align="end"
          trigger={(open) => (
            <button type="button" className="icon-btn task-menu" onClick={open} aria-label="ações">
              ⋯
            </button>
          )}
        >
          {(close) => (
            <ul className="picker-list">
              <li>
                <strong className="picker-section">Mover para</strong>
              </li>
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
              <li className="divider" />
              <li>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    close();
                    handleDelete();
                  }}
                >
                  Apagar tarefa
                </button>
              </li>
            </ul>
          )}
        </Popover>
      </div>

      {expanded && (
        <div className="task-expanded">
          <label className="task-note-label">
            <span className="muted">Nota:&nbsp;</span>
            <InlineEdit
              value={task.note}
              onSave={setNote}
              placeholder="(sem nota)"
              multiline
              className="task-note-edit"
            />
          </label>
          <SubtaskList subtasks={task.subtasks} onChange={setSubtasks} />
        </div>
      )}

      {!expanded && task.subtasks.length > 0 && (
        <p className="muted subtask-summary">
          {task.subtasks.filter((s) => s.checked).length}/{task.subtasks.length} subtarefas
        </p>
      )}

      {depModalOpen && (
        <DepPicker
          task={task}
          allTasks={allTasks}
          onClose={() => setDepModalOpen(false)}
          onChange={setDeps}
        />
      )}
    </article>
  );
}
