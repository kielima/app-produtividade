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
import { TaskCard } from '../components/TaskCard';
import { isTaskBlocked } from '../lib/score';
import { patchTask } from '../lib/taskMutations';
import type { MoSCoW, ScoreContext, Task } from '../types';

const DROP_PREFIX = 'tmoscow:';

interface QuadrantSpec {
  key: Exclude<MoSCoW, ''>;
  label: string;
  desc: string;
  badgeClass: string;
}

// Os quatro quadrantes da matriz (2×2), em ordem decrescente de prioridade.
// Won't é a base: tarefas sem classificação caem aqui (ver ProjectMoscowMatrix).
const QUADRANTS: QuadrantSpec[] = [
  { key: 'must', label: 'Must', desc: 'Crítico — prioridade máxima', badgeClass: 'col-must' },
  { key: 'should', label: 'Should', desc: 'Importante — fazer em seguida', badgeClass: 'col-should' },
  { key: 'could', label: 'Could', desc: 'Desejável — se houver tempo', badgeClass: 'col-could' },
  { key: 'wont', label: "Won't", desc: 'Base — fora do escopo atual', badgeClass: 'col-wont' },
];

export function TaskMoscowMatrix({
  uid,
  tasks,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  ctx: ScoreContext;
}) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const visible = useMemo(() => tasks.filter((t) => !t.checked), [tasks]);

  const taskMap = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of visible) m[t.id] = t;
    return m;
  }, [visible]);

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { must: [], should: [], could: [], wont: [] };
    for (const t of visible) {
      // Won't é a base: sem MoSCoW cai em Won't.
      const k = t.moscow || 'wont';
      (g[k] ??= []).push(t);
    }
    return g;
  }, [visible]);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith(DROP_PREFIX)) return;
    const newKey = overId.slice(DROP_PREFIX.length);

    const taskId = String(e.active.id);
    const task = taskMap[taskId];
    if (!task) return;
    const current = task.moscow || 'wont';
    if (current === newKey) return;

    await patchTask(uid, task, { moscow: newKey as MoSCoW });
  }

  const activeTask = activeDragId ? taskMap[activeDragId] : null;

  function renderQuadrant(spec: QuadrantSpec) {
    const list = grouped[spec.key] ?? [];
    return (
      <div key={spec.key} className="moscow-quadrant">
        <header className={`moscow-quadrant-header ${spec.badgeClass}`}>
          <div className="moscow-quadrant-heading">
            <span className="moscow-quadrant-label">{spec.label}</span>
            <span className="moscow-quadrant-desc">{spec.desc}</span>
          </div>
          <span className="moscow-quadrant-count">{list.length}</span>
        </header>
        <DroppableSection id={`${DROP_PREFIX}${spec.key}`}>
          <div className="task-list moscow-quadrant-body">
            {list.map((t) => (
              <DraggableTaskCard key={t.id} uid={uid} task={t} blocked={isTaskBlocked(t, ctx)} />
            ))}
            {list.length === 0 && (
              <p className="drop-hint muted">arraste tarefas aqui</p>
            )}
          </div>
        </DroppableSection>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="moscow-matrix">{QUADRANTS.map(renderQuadrant)}</div>

      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className="drag-overlay">
            <TaskCard uid={uid} task={activeTask} blocked={isTaskBlocked(activeTask, ctx)} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
