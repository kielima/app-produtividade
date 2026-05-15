import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import { DraggableTaskCard } from '../components/DraggableTaskCard';
import { DroppableSection } from '../components/DroppableSection';
import { NewTaskInput } from '../components/NewTaskInput';
import { SectionHeader } from '../components/SectionHeader';
import { TaskCard } from '../components/TaskCard';
import { isTaskBlocked } from '../lib/score';
import { patchTask } from '../lib/taskMutations';
import { createSection } from '../repositories/sectionsRepo';
import { archiveCompletedTasks } from '../repositories/tasksRepo';
import type { MoSCoW, ScoreContext, Section, Task } from '../types';

const MOSCOW_FILTERS: Array<{ value: MoSCoW | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'must', label: 'Must' },
  { value: 'should', label: 'Should' },
  { value: 'could', label: 'Could' },
  { value: 'wont', label: "Won't" },
];

export function ListView({
  uid,
  tasks,
  sections,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  sections: Section[];
  ctx: ScoreContext;
}) {
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [moscowFilter, setMoscowFilter] = useState<MoSCoW | 'all'>('all');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null);
  const [newSectionName, setNewSectionName] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const taskMap = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (hideCompleted && t.checked) return false;
        if (sectionFilter !== 'all' && t.section !== sectionFilter) return false;
        if (moscowFilter !== 'all' && t.moscow !== moscowFilter) return false;
        return true;
      }),
    [tasks, sectionFilter, moscowFilter, hideCompleted],
  );

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = {};
    for (const t of filtered) {
      const key = t.section || '(sem seção)';
      (g[key] ??= []).push(t);
    }
    return g;
  }, [filtered]);

  const visibleSections = useMemo(() => {
    if (sectionFilter !== 'all') return sections.filter((s) => s.id === sectionFilter);
    return sections;
  }, [sections, sectionFilter]);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;

    const taskId = String(e.active.id);
    const task = taskMap[taskId];
    if (!task || task.section === overId) return;
    await patchTask(uid, task, { section: overId });
  }

  async function handleArchiveNow() {
    const n = await archiveCompletedTasks(uid);
    setArchiveMsg(n > 0 ? `${n} tarefa(s) arquivada(s).` : 'Nada para arquivar.');
    setTimeout(() => setArchiveMsg(null), 4000);
  }

  async function handleAddSection() {
    const name = newSectionName.trim();
    if (!name) {
      setAddingSection(false);
      setNewSectionName('');
      return;
    }
    await createSection(uid, name, '', sections.length);
    setNewSectionName('');
    setAddingSection(false);
  }

  const activeTask = activeDragId ? taskMap[activeDragId] : null;

  return (
    <section className="list-view">
      <header className="filters">
        <label>
          Seção:&nbsp;
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
            <option value="all">Todas</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          MoSCoW:&nbsp;
          <select
            value={moscowFilter}
            onChange={(e) => setMoscowFilter(e.target.value as MoSCoW | 'all')}
          >
            {MOSCOW_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          &nbsp;ocultar concluídas
        </label>
        <span className="counter">
          {filtered.length} de {tasks.length}
        </span>
        <button type="button" className="btn-secondary" onClick={handleArchiveNow}>
          Arquivar concluídas
        </button>
      </header>

      {archiveMsg && <p className="toast">{archiveMsg}</p>}

      {visibleSections.length === 0 && tasks.length === 0 && (
        <p className="muted">
          Nada por aqui. Crie a primeira seção abaixo ou rode o script de migração.
        </p>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {visibleSections.map((sec) => {
          const list = grouped[sec.id] ?? [];
          const totalInSection = tasks.filter((t) => t.section === sec.id).length;
          return (
            <div key={sec.id} className="section-group">
              <SectionHeader uid={uid} section={sec} taskCount={totalInSection} />
              <DroppableSection id={sec.id}>
                <div className="task-list">
                  {list.map((t) => (
                    <DraggableTaskCard
                      key={t.id}
                      uid={uid}
                      task={t}
                      blocked={isTaskBlocked(t, ctx)}
                      sections={sections}
                      allTasks={tasks}
                    />
                  ))}
                  {list.length === 0 && (
                    <p className="drop-hint muted">solte aqui para mover</p>
                  )}
                  <NewTaskInput uid={uid} sectionId={sec.id} />
                </div>
              </DroppableSection>
            </div>
          );
        })}

        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="drag-overlay">
              <TaskCard
                uid={uid}
                task={activeTask}
                blocked={isTaskBlocked(activeTask, ctx)}
                sections={sections}
                allTasks={tasks}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div className="add-section-row">
        {addingSection ? (
          <input
            type="text"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onBlur={handleAddSection}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddSection();
              if (e.key === 'Escape') {
                setNewSectionName('');
                setAddingSection(false);
              }
            }}
            placeholder="Nome da nova seção…"
            autoFocus
            className="inline-edit-input"
          />
        ) : (
          <button type="button" className="link-btn" onClick={() => setAddingSection(true)}>
            + adicionar seção
          </button>
        )}
      </div>
    </section>
  );
}
