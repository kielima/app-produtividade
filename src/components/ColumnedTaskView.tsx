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
import { patchTask } from '../lib/taskMutations';
import type { Section, Task } from '../types';
import { DraggableTaskCard } from './DraggableTaskCard';
import { DroppableSection } from './DroppableSection';
import { TaskCard } from './TaskCard';

export interface ColumnSpec {
  key: string;
  label: string;
  badgeClass?: string;
}

const COL_PREFIX = 'col:';

/**
 * View genérica que agrupa tarefas em colunas e permite mover entre
 * colunas via drag & drop. Usada por Kanban, MoSCoW, Modo, Esforço.
 *
 * - `groupBy(task)` precisa devolver uma das `columns[].key`.
 * - `applyChange(task, newKey)` retorna o patch parcial a aplicar quando
 *   uma tarefa é solta numa coluna diferente. Ex: para Kanban move
 *   { checked: false, inProgress: true } quando solta em "doing".
 */
export function ColumnedTaskView({
  uid,
  tasks,
  sections,
  allTasks,
  blocked,
  columns,
  groupBy,
  applyChange,
  emptyHint,
}: {
  uid: string;
  tasks: Task[];
  sections: Section[];
  allTasks: Task[];
  blocked: (task: Task) => boolean;
  columns: ColumnSpec[];
  groupBy: (task: Task) => string;
  applyChange: (task: Task, newKey: string) => Partial<Task>;
  emptyHint?: string;
}) {
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

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = {};
    for (const c of columns) g[c.key] = [];
    for (const t of tasks) {
      const k = groupBy(t);
      (g[k] ??= []).push(t);
    }
    return g;
  }, [tasks, columns, groupBy]);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith(COL_PREFIX)) return;
    const newKey = overId.slice(COL_PREFIX.length);

    const taskId = String(e.active.id);
    const task = taskMap[taskId];
    if (!task || groupBy(task) === newKey) return;

    await patchTask(uid, task, applyChange(task, newKey));
  }

  const activeTask = activeDragId ? taskMap[activeDragId] : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="columned-view">
        {columns.map((col) => {
          const list = grouped[col.key] ?? [];
          return (
            <div key={col.key} className="columned-col">
              <header className={`columned-col-header ${col.badgeClass ?? ''}`}>
                <span className="columned-col-label">{col.label}</span>
                <span className="muted">{list.length}</span>
              </header>
              <DroppableSection id={`${COL_PREFIX}${col.key}`}>
                <div className="task-list columned-col-body">
                  {list.map((t) => (
                    <DraggableTaskCard
                      key={t.id}
                      uid={uid}
                      task={t}
                      blocked={blocked(t)}
                      sections={sections}
                      allTasks={allTasks}
                    />
                  ))}
                  {list.length === 0 && (
                    <p className="drop-hint muted">{emptyHint ?? 'solte aqui'}</p>
                  )}
                </div>
              </DroppableSection>
            </div>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className="drag-overlay">
            <TaskCard
              uid={uid}
              task={activeTask}
              blocked={blocked(activeTask)}
              sections={sections}
              allTasks={allTasks}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
