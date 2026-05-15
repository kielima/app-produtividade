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
import { calcScore, isTaskBlocked } from '../lib/score';
import { patchTask } from '../lib/taskMutations';
import { createSection } from '../repositories/sectionsRepo';
import type { ScoreContext, Section, Task } from '../types';

/**
 * Visão Board: colunas horizontais lado a lado, uma por seção.
 * Tasks ordenadas por score descendente, bloqueadas empurradas pro fim
 * (mesma regra do renderBoard() do dashboard).
 */
export function BoardView({
  uid,
  tasks,
  sections,
  sectionMap,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  sections: Section[];
  sectionMap: Record<string, Section>;
  ctx: ScoreContext;
}) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [newSectionName, setNewSectionName] = useState('');
  const [addingSection, setAddingSection] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const taskMap = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  const tasksBySection = useMemo(() => {
    const g: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (hideCompleted && t.checked) continue;
      (g[t.section] ??= []).push(t);
    }
    // Ordena cada coluna: bloqueadas no fim, depois por score desc.
    for (const sec of sections) {
      const list = g[sec.id] ?? [];
      list.sort((a, b) => {
        const aBlk = isTaskBlocked(a, ctx) ? 1 : 0;
        const bBlk = isTaskBlocked(b, ctx) ? 1 : 0;
        if (aBlk !== bBlk) return aBlk - bBlk;
        return (
          calcScore(b, sectionMap[b.section] ?? null, ctx) -
          calcScore(a, sectionMap[a.section] ?? null, ctx)
        );
      });
      g[sec.id] = list;
    }
    return g;
  }, [tasks, sections, sectionMap, ctx, hideCompleted]);

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
    <section className="board-view">
      <header className="filters">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          &nbsp;ocultar concluídas
        </label>
        <span className="counter">
          {sections.length} seç{sections.length === 1 ? 'ão' : 'ões'}
        </span>
      </header>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board-columns">
          {sections.map((sec) => {
            const list = tasksBySection[sec.id] ?? [];
            const totalInSection = tasks.filter((t) => t.section === sec.id).length;
            return (
              <div key={sec.id} className="board-column">
                <SectionHeader uid={uid} section={sec} taskCount={totalInSection} />
                <DroppableSection id={sec.id}>
                  <div className="task-list board-column-body">
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
                      <p className="drop-hint muted">solte aqui</p>
                    )}
                    <NewTaskInput uid={uid} sectionId={sec.id} />
                  </div>
                </DroppableSection>
              </div>
            );
          })}

          <div className="board-column board-add-column">
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
                placeholder="Nome da seção…"
                autoFocus
                className="inline-edit-input"
              />
            ) : (
              <button
                type="button"
                className="board-add-btn"
                onClick={() => setAddingSection(true)}
              >
                + adicionar seção
              </button>
            )}
          </div>
        </div>

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
    </section>
  );
}
