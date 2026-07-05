import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CopyMarkdownButton } from '../components/CopyMarkdownButton';
import LinkIcon from '../components/LinkIcon';
import { DepPicker } from '../components/DepPicker';
import { InlineEdit } from '../components/InlineEdit';
import { MarkdownNote } from '../components/MarkdownNote';
import { ParentPicker } from '../components/ParentPicker';
import { Popover } from '../components/Popover';
import { ProjectPicker } from '../components/ProjectPicker';
import TrashIcon from '../components/TrashIcon';
import { AiSubtasksError, generateSubtasks, hasGeminiApiKey } from '../lib/aiSubtasks';
import { getDisplayTitle } from '../lib/parser';
import { calcScore, isTaskBlocked } from '../lib/score';
import {
  formatSnoozeUntil,
  isSnoozed,
  snoozeRemainingLabel,
  snoozeUntilForDays,
  snoozeUntilForHours,
  todayISO,
  SNOOZE_HOUR_PRESETS,
  SNOOZE_PRESETS,
} from '../lib/snooze';
import { ScoreDetailView } from './ScoreDetailView';
import {
  createChildTask,
  createParentTask,
  orphanChildren,
  patchTask,
  setTaskParent,
} from '../lib/taskMutations';
import { getChildren, hasIncompleteChildren } from '../lib/taskHierarchy';
import { useTaskNavigation } from '../lib/taskNavigation';
import { deleteTask } from '../repositories/tasksRepo';
import type {
  Esforco,
  Modo,
  MoSCoW,
  Project,
  ScoreContext,
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
  const { openTask } = useTaskNavigation();
  const [depModalOpen, setDepModalOpen] = useState(false);
  const [parentModalOpen, setParentModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [scoreDetailOpen, setScoreDetailOpen] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childDraft, setChildDraft] = useState('');
  const [customSnoozeHours, setCustomSnoozeHours] = useState('');
  const deadlineInputRef = useRef<HTMLInputElement>(null);
  const snoozed = isSnoozed(task);
  const parent = task.parentId
    ? allTasks.find((t) => t.id === task.parentId) ?? null
    : null;
  // Ordena as filhas pela ordem manual (`order`, definida ao arrastar) e, na
  // ausência dela, pela ordem de criação (`taskId`). Filhas ainda sem `order`
  // (ex.: recém-criadas) caem no fim, depois das já reordenadas.
  const children = useMemo(() => {
    const orderKey = (t: Task) =>
      t.order != null ? t.order : (t.taskId ?? 0);
    return getChildren(task.id, allTasks).sort((a, b) => orderKey(a) - orderKey(b));
  }, [task.id, allTasks]);
  const doneChildren = children.filter((c) => c.checked).length;
  const blocked = isTaskBlocked(task, ctx);
  const score = useMemo(
    () => calcScore(task, projectMap[task.section] ?? null, ctx),
    [task, projectMap, ctx],
  );
  const project = projectMap[task.section];

  // Sensores de arraste para reordenar subtarefas. PointerSensor com pequena
  // distância evita disparar em cliques; TouchSensor com atraso permite
  // rolar a página normalmente no telemóvel até segurar a subtarefa.
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    if (next === 'done' && hasIncompleteChildren(task.id, allTasks)) {
      window.alert('Conclua todas as subtarefas antes de concluir esta tarefa.');
      return;
    }
    await patchTask(uid, task, statusPatch(next));
  }

  async function handleAddChild() {
    const childId = await createChildTask(uid, task);
    openTask(childId);
  }

  // Adição rápida inline: cria uma subtarefa (filha) com o título digitado,
  // copiando os detalhes do pai, sem sair da tela.
  async function handleQuickAddChild() {
    const title = childDraft.trim();
    if (!title) {
      setAddingChild(false);
      setChildDraft('');
      return;
    }
    await createChildTask(uid, task, title);
    setChildDraft('');
    // Mantém o campo aberto para adicionar várias em sequência.
  }

  // Reordena as subtarefas ao arrastar: calcula a nova sequência e persiste
  // um `order` sequencial (0, 1, 2, …) em cada filha cuja posição mudou.
  async function handleChildrenDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = children.findIndex((c) => c.id === active.id);
    const newIndex = children.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(children, oldIndex, newIndex);
    await Promise.all(
      reordered
        .map((c, i) => (c.order === i ? null : patchTask(uid, c, { order: i })))
        .filter((p): p is Promise<Task> => p !== null),
    );
  }

  async function selectParent(parentId: string) {
    await setTaskParent(uid, task, parentId);
    setParentModalOpen(false);
  }

  async function createNewParent() {
    // Cria um novo pai (cópia dos detalhes) e vincula a tarefa atual a ele.
    const newParentId = await createParentTask(uid, task);
    await setTaskParent(uid, task, newParentId);
    setParentModalOpen(false);
    openTask(newParentId);
  }

  async function removeParent() {
    await setTaskParent(uid, task, null);
  }

  async function toggleChild(child: Task) {
    if (!child.checked && hasIncompleteChildren(child.id, allTasks)) {
      window.alert('Conclua as subtarefas desta subtarefa primeiro.');
      return;
    }
    if (!child.checked && isTaskBlocked(child, ctx)) {
      window.alert('Esta subtarefa está bloqueada: conclua a subtarefa anterior primeiro.');
      return;
    }
    await patchTask(uid, child, { checked: !child.checked });
  }

  // Referência usada em dependsOn para apontar para `task` (#id quando existe).
  function depRefFor(t: Task): string | null {
    if (t.taskId != null) return `#${t.taskId}`;
    const title = getDisplayTitle(t.title).trim();
    return title || null;
  }

  // Alterna a dependência da subtarefa `cur` face à subtarefa anterior `prev`:
  // quando ligadas, `cur` fica bloqueada até `prev` ser concluída.
  async function toggleChildLink(prev: Task, cur: Task) {
    const ref = depRefFor(prev);
    if (!ref) return;
    const deps = cur.dependsOn ?? [];
    const has = deps.includes(ref);
    const next = has ? deps.filter((d) => d !== ref) : [...deps, ref];
    await patchTask(uid, cur, { dependsOn: next });
  }

  // Indica se `cur` já depende de `prev` (vínculo direto criado pelo botão).
  function childDependsOn(prev: Task, cur: Task): boolean {
    const ref = depRefFor(prev);
    return !!ref && (cur.dependsOn ?? []).includes(ref);
  }

  async function handleGenerateSubtasks() {
    setAiError(null);
    setAiLoading(true);
    try {
      const existing = children.map((c) => getDisplayTitle(c.title));
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
      // Cria uma subtarefa (filha) por sugestão, em série para manter os
      // taskIds sequenciais (nextTaskId lê o máximo atual a cada chamada).
      for (const title of fresh) {
        await createChildTask(uid, task, title);
      }
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

  async function snoozeForDays(days: number) {
    await patchTask(uid, task, { snoozedUntil: snoozeUntilForDays(days) });
  }

  async function snoozeForHours(hours: number) {
    await patchTask(uid, task, { snoozedUntil: snoozeUntilForHours(hours) });
  }

  async function snoozeUntilDate(dateISO: string) {
    // Só adia para datas futuras — o seletor já restringe via `min`, mas
    // protege contra escolhas inválidas (hoje/passado não silenciam nada).
    if (!dateISO || dateISO <= todayISO()) return;
    await patchTask(uid, task, { snoozedUntil: dateISO });
  }

  async function clearSnooze() {
    await patchTask(uid, task, { snoozedUntil: null });
  }

  function handleCustomHours() {
    const hours = parseInt(customSnoozeHours, 10);
    if (!Number.isFinite(hours) || hours < 1) return;
    void snoozeForHours(hours);
    setCustomSnoozeHours('');
  }

  async function moveToSection(newSectionId: string) {
    await patchTask(uid, task, { section: newSectionId });
    await Promise.all(children.map((c) => patchTask(uid, c, { section: newSectionId })));
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
    const msg =
      children.length > 0
        ? `Apagar "${display}"? As ${children.length} subtarefa(s) voltarão a ser tarefas normais.`
        : `Apagar "${display}"?`;
    if (!window.confirm(msg)) return;
    if (children.length > 0) await orphanChildren(uid, task.id, allTasks);
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

  if (scoreDetailOpen) {
    return (
      <ScoreDetailView
        task={task}
        project={project ?? null}
        ctx={ctx}
        onClose={() => setScoreDetailOpen(false)}
      />
    );
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
          {task.addedDate ? `Adicionada em ${task.addedDate.replace(/^\d{2}(\d{2})/, '$1')}` : ''}
        </span>
        <span className="task-detail-topbar-right">
          <button
            type="button"
            className="badge score score-button"
            title="ver memorial de cálculo"
            onClick={() => setScoreDetailOpen(true)}
          >
            {score.toFixed(2)}
          </button>
          <button
            type="button"
            className="task-detail-delete"
            onClick={handleDelete}
            aria-label="apagar tarefa"
            title="apagar tarefa"
          >
            <TrashIcon size={22} />
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

        {snoozed && (
          <p className="badge snoozed-banner task-detail-blocked">
            💤 adiada até {formatSnoozeUntil(task.snoozedUntil!)} ·{' '}
            {snoozeRemainingLabel(task)}
          </p>
        )}

        {parent && (
          <div className="task-detail-parent">
            <span className="muted">Subtarefa de</span>{' '}
            <button
              type="button"
              className="task-detail-parent-link"
              onClick={() => openTask(parent.id)}
            >
              {getDisplayTitle(parent.title)}
            </button>
            <button
              type="button"
              className="link-btn task-detail-parent-remove"
              onClick={removeParent}
              title="desvincular do pai"
            >
              remover pai
            </button>
          </div>
        )}

        <div className="task-detail-hierarchy-actions">
          {!parent && (
            <button
              type="button"
              className="link-btn"
              onClick={() => setParentModalOpen(true)}
            >
              ⬆️ Adicionar pai
            </button>
          )}
          <button type="button" className="link-btn" onClick={handleAddChild}>
            ➕ Adicionar filho
          </button>
        </div>

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
              <ProjectPicker
                projects={projects}
                currentSection={task.section}
                onSelect={(id) => {
                  moveToSection(id);
                  close();
                }}
              />
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

          <Popover
            align="start"
            trigger={(open, isOpen) => (
              <button
                type="button"
                className={`badge snooze${snoozed ? ' active' : ''}${isOpen ? ' open' : ''}`}
                onClick={open}
                title={
                  snoozed
                    ? `Adiada até ${formatSnoozeUntil(task.snoozedUntil!)}`
                    : 'Adiar (silenciar temporariamente)'
                }
              >
                💤 {snoozed ? `até ${formatSnoozeUntil(task.snoozedUntil!)}` : 'Adiar'}
              </button>
            )}
          >
            {(close) => (
              <div className="snooze-menu">
                <p className="snooze-menu-title">Adiar por…</p>
                <ul className="picker-list">
                  {SNOOZE_PRESETS.map((p) => (
                    <li key={p.days}>
                      <button
                        type="button"
                        onClick={() => {
                          void snoozeForDays(p.days);
                          close();
                        }}
                      >
                        {p.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="snooze-menu-title">Adiar até a data…</p>
                <input
                  type="date"
                  className="snooze-date-input"
                  min={snoozeUntilForDays(1)}
                  value=""
                  onChange={(e) => {
                    void snoozeUntilDate(e.target.value);
                    close();
                  }}
                  aria-label="adiar até a data"
                />
                <p className="snooze-menu-title">Adiar por horas…</p>
                <ul className="picker-list">
                  {SNOOZE_HOUR_PRESETS.map((p) => (
                    <li key={p.hours}>
                      <button
                        type="button"
                        onClick={() => {
                          void snoozeForHours(p.hours);
                          close();
                        }}
                      >
                        {p.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="snooze-custom">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    className="snooze-custom-input"
                    placeholder="nº de horas"
                    value={customSnoozeHours}
                    onChange={(e) => setCustomSnoozeHours(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCustomHours();
                        close();
                      }
                    }}
                    aria-label="número de horas para adiar"
                  />
                  <button
                    type="button"
                    className="btn-secondary snooze-custom-btn"
                    onClick={() => {
                      handleCustomHours();
                      close();
                    }}
                    disabled={!customSnoozeHours.trim()}
                  >
                    Adiar
                  </button>
                </div>
                {snoozed && (
                  <button
                    type="button"
                    className="snooze-clear"
                    onClick={() => {
                      void clearSnooze();
                      close();
                    }}
                  >
                    Reativar agora
                  </button>
                )}
              </div>
            )}
          </Popover>
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
          <div className="task-detail-subtasks-header">
            <h3>
              Subtarefas{' '}
              {children.length > 0 && (
                <span className="muted">
                  ({doneChildren}/{children.length})
                </span>
              )}
            </h3>
            <div className="task-detail-subtasks-actions">
              <button
                type="button"
                className="link-btn"
                onClick={() => setAddingChild(true)}
              >
                + adicionar
              </button>
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
          </div>
          {aiError && <p className="error task-detail-ai-error">{aiError}</p>}
          {children.length === 0 && !addingChild && (
            <p className="muted">Sem subtarefas.</p>
          )}
          {(children.length > 0 || addingChild) && (
            <ul className="task-detail-children">
              <DndContext
                sensors={dragSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleChildrenDragEnd}
              >
                <SortableContext
                  items={children.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {children.map((c, i) => {
                    const prev = i > 0 ? children[i - 1] : null;
                    const childBlocked = !c.checked && isTaskBlocked(c, ctx);
                    return (
                      <Fragment key={c.id}>
                        {prev && (
                          <li className="task-detail-child-link-row">
                            <button
                              type="button"
                              className={`subtask-link-btn${childDependsOn(prev, c) ? ' linked' : ''}`}
                              onClick={() => toggleChildLink(prev, c)}
                              aria-pressed={childDependsOn(prev, c)}
                              title={
                                childDependsOn(prev, c)
                                  ? 'Remover dependência: esta subtarefa deixa de ficar bloqueada pela anterior'
                                  : 'Criar dependência: esta subtarefa fica bloqueada até a anterior ser concluída'
                              }
                              aria-label={
                                childDependsOn(prev, c)
                                  ? 'remover dependência entre subtarefas'
                                  : 'criar dependência entre subtarefas'
                              }
                            >
                              <LinkIcon size={16} />
                            </button>
                          </li>
                        )}
                        <SortableChildRow
                          id={c.id}
                          title={getDisplayTitle(c.title) || '(sem título)'}
                          checked={c.checked}
                          blocked={childBlocked}
                          onToggle={() => toggleChild(c)}
                          onOpen={() => openTask(c.id)}
                        />
                      </Fragment>
                    );
                  })}
                </SortableContext>
              </DndContext>
              {addingChild && (
                <li className="task-detail-child task-detail-child-add">
                  <input
                    type="text"
                    className="inline-edit-input"
                    value={childDraft}
                    onChange={(e) => setChildDraft(e.target.value)}
                    onBlur={handleQuickAddChild}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleQuickAddChild();
                      }
                      if (e.key === 'Escape') {
                        setChildDraft('');
                        setAddingChild(false);
                      }
                    }}
                    placeholder="Nova subtarefa…"
                    autoFocus
                  />
                </li>
              )}
            </ul>
          )}
        </section>

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

      {parentModalOpen && (
        <ParentPicker
          task={task}
          allTasks={allTasks}
          projects={projects}
          onClose={() => setParentModalOpen(false)}
          onSelectParent={selectParent}
          onCreateNewParent={createNewParent}
        />
      )}
    </section>
  );
}

// Linha de uma subtarefa (filha) arrastável: traz um "punho" à esquerda para
// segurar e reordenar, além do checkbox e do link para abrir a subtarefa.
function SortableChildRow({
  id,
  title,
  checked,
  blocked,
  onToggle,
  onOpen,
}: {
  id: string;
  title: string;
  checked: boolean;
  blocked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`task-detail-child${checked ? ' done' : ''}${blocked ? ' subtask-blocked' : ''}`}
    >
      <button
        type="button"
        className="subtask-drag-handle"
        aria-label="arrastar para reordenar"
        {...attributes}
        {...listeners}
      >
        <svg
          width="12"
          height="18"
          viewBox="0 0 14 20"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="4" cy="4" r="1.4" fill="currentColor" />
          <circle cx="10" cy="4" r="1.4" fill="currentColor" />
          <circle cx="4" cy="10" r="1.4" fill="currentColor" />
          <circle cx="10" cy="10" r="1.4" fill="currentColor" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" />
          <circle cx="10" cy="16" r="1.4" fill="currentColor" />
        </svg>
      </button>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={blocked}
        aria-label="alternar subtarefa"
        title={blocked ? 'Bloqueada: conclua a subtarefa anterior primeiro' : undefined}
      />
      <button type="button" className="task-detail-child-link" onClick={onOpen}>
        {title}
      </button>
    </li>
  );
}
