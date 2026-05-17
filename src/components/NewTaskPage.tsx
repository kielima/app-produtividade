import { useEffect, useMemo, useState } from 'react';
import { getDisplayTitle, serializeTitle } from '../lib/parser';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
import type {
  Esforco,
  Modo,
  MoSCoW,
  Project,
  Subtask,
  Task,
} from '../types';
import { DepPicker } from './DepPicker';
import { SubtaskList } from './SubtaskList';

type KanbanStatus = 'todo' | 'doing' | 'done';

const STATUS_LABEL: Record<KanbanStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluída',
};

const MOSCOW_LABEL: Record<MoSCoW, string> = {
  '': '—',
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
};

const MODO_LABEL: Record<Modo, string> = {
  '': '—',
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
  automatizar: 'Automatizar',
};

const ESFORCO_LABEL: Record<Esforco, string> = {
  '': '—',
  rapido: 'Rápido',
  medio: 'Médio',
  longo: 'Longo',
};

const STATUS_OPTS: KanbanStatus[] = ['todo', 'doing', 'done'];
const MOSCOW_OPTS: MoSCoW[] = ['', 'must', 'should', 'could', 'wont'];
const MODO_OPTS: Modo[] = ['', 'manual', 'colaborar', 'delegar', 'automatizar'];
const ESFORCO_OPTS: Esforco[] = ['', 'rapido', 'medio', 'longo'];

function isHiddenProject(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

function statusFlags(s: KanbanStatus): Pick<Task, 'checked' | 'inProgress'> {
  if (s === 'todo') return { checked: false, inProgress: false };
  if (s === 'doing') return { checked: false, inProgress: true };
  return { checked: true, inProgress: false };
}

export function NewTaskPage({
  uid,
  projects,
  allTasks,
  defaultProjectId,
  onClose,
}: {
  uid: string;
  projects: Project[];
  allTasks: Task[];
  defaultProjectId: string;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const availableProjects = useMemo(
    () => projects.filter((p) => !isHiddenProject(p)),
    [projects],
  );

  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState(() => {
    if (defaultProjectId && availableProjects.some((p) => p.id === defaultProjectId)) {
      return defaultProjectId;
    }
    return availableProjects[0]?.id ?? '';
  });
  const [status, setStatus] = useState<KanbanStatus>('todo');
  const [moscow, setMoscow] = useState<MoSCoW>('');
  const [modo, setModo] = useState<Modo>('');
  const [esforco, setEsforco] = useState<Esforco>('');
  const [deadline, setDeadline] = useState('');
  const [note, setNote] = useState('');
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [depPickerOpen, setDepPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !depPickerOpen) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, depPickerOpen]);

  const canSave =
    !saving && title.trim().length > 0 && sectionId.length > 0;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    try {
      const taskId = await nextTaskId(uid);
      const flags = statusFlags(status);
      const newTask: Task = {
        id: String(taskId),
        taskId,
        title: serializeTitle(title.trim(), {
          taskId,
          modo,
          moscow,
          esforco,
          deadline,
          addedDate: today,
          dependsOn,
        }),
        note,
        checked: flags.checked,
        inProgress: flags.inProgress,
        moscow,
        modo,
        esforco,
        deadline,
        addedDate: today,
        dependsOn,
        subtasks,
        section: sectionId,
      };
      await upsertTask(uid, newTask);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const draftForDeps: Task = {
    id: '__draft__',
    taskId: null,
    title: title.trim() || '(nova tarefa)',
    note: '',
    checked: false,
    inProgress: false,
    moscow: '',
    modo: '',
    esforco: '',
    deadline: '',
    addedDate: today,
    dependsOn,
    subtasks: [],
    section: sectionId,
  };

  const resolveDepLabel = (dep: string): string => {
    const m = dep.trim().match(/^#(\d+)$/);
    if (m) {
      const other = allTasks.find((t) => t.taskId === parseInt(m[1]!, 10));
      if (other) return `${dep} — ${getDisplayTitle(other.title)}`;
    }
    return dep;
  };

  return (
    <div className="task-editor-overlay" role="dialog" aria-modal="true" aria-label="Nova tarefa">
      <header className="task-editor-header">
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="fechar"
          disabled={saving}
        >
          ×
        </button>
        <h2>Nova tarefa</h2>
        <button
          type="button"
          className="btn-primary"
          onClick={submit}
          disabled={!canSave}
        >
          Salvar
        </button>
      </header>

      <div className="task-editor-body">
        <label className="task-editor-field">
          <span>Título</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Descreva a tarefa…"
            autoFocus
            disabled={saving}
            className="inline-edit-input task-editor-title"
          />
        </label>

        <label className="task-editor-field">
          <span>Projeto</span>
          {availableProjects.length === 0 ? (
            <p className="muted">Crie um projeto antes de adicionar uma tarefa.</p>
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

        <fieldset className="task-editor-fieldset">
          <legend>Tags</legend>

          <label className="task-editor-field">
            <span>Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as KanbanStatus)}
              disabled={saving}
              className="inline-edit-input"
            >
              {STATUS_OPTS.map((v) => (
                <option key={v} value={v}>
                  {STATUS_LABEL[v]}
                </option>
              ))}
            </select>
          </label>

          <label className="task-editor-field">
            <span>MoSCoW</span>
            <select
              value={moscow}
              onChange={(e) => setMoscow(e.target.value as MoSCoW)}
              disabled={saving}
              className="inline-edit-input"
            >
              {MOSCOW_OPTS.map((v) => (
                <option key={v} value={v}>
                  {MOSCOW_LABEL[v]}
                </option>
              ))}
            </select>
          </label>

          <label className="task-editor-field">
            <span>Modo</span>
            <select
              value={modo}
              onChange={(e) => setModo(e.target.value as Modo)}
              disabled={saving}
              className="inline-edit-input"
            >
              {MODO_OPTS.map((v) => (
                <option key={v} value={v}>
                  {MODO_LABEL[v]}
                </option>
              ))}
            </select>
          </label>

          <label className="task-editor-field">
            <span>Esforço</span>
            <select
              value={esforco}
              onChange={(e) => setEsforco(e.target.value as Esforco)}
              disabled={saving}
              className="inline-edit-input"
            >
              {ESFORCO_OPTS.map((v) => (
                <option key={v} value={v}>
                  {ESFORCO_LABEL[v]}
                </option>
              ))}
            </select>
          </label>

          <label className="task-editor-field">
            <span>Prazo</span>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={saving}
              className="inline-edit-input"
            />
          </label>
        </fieldset>

        <label className="task-editor-field">
          <span>Descrição</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Detalhes, contexto, links…"
            rows={5}
            disabled={saving}
            className="inline-edit-input task-editor-note"
          />
        </label>

        <section className="task-editor-field">
          <span>Subtarefas</span>
          <SubtaskList subtasks={subtasks} onChange={setSubtasks} />
        </section>

        <section className="task-editor-field">
          <span>Encadeamento (depende de)</span>
          {dependsOn.length === 0 ? (
            <p className="muted">Sem dependências.</p>
          ) : (
            <ul className="task-editor-deps">
              {dependsOn.map((d) => (
                <li key={d}>
                  <span>{resolveDepLabel(d)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setDependsOn(dependsOn.filter((x) => x !== d))}
                    aria-label="remover"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => setDepPickerOpen(true)}
          >
            + adicionar dependência
          </button>
        </section>
      </div>

      {depPickerOpen && (
        <DepPicker
          task={draftForDeps}
          allTasks={allTasks}
          onClose={() => setDepPickerOpen(false)}
          onChange={setDependsOn}
        />
      )}
    </div>
  );
}
