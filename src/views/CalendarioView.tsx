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
import { DroppableDay, MiniTaskItem } from '../components/MiniTaskItem';
import {
  buildMonthGrid,
  DAY_NAMES_SHORT,
  monthLabel,
  shiftMonth,
  todayIso,
} from '../lib/calendar';
import { calcScore } from '../lib/score';
import { patchTask } from '../lib/taskMutations';
import type { Project, ScoreContext, Task } from '../types';

const SIDEBAR_DROP_ID = 'sidebar';
const DAY_DROP_PREFIX = 'day:';

/**
 * View Calendário: grid mensal + sidebar com tarefas sem prazo
 * (ordenadas por score). Drag de qualquer task para uma célula de dia
 * atribui task.deadline = ISO daquele dia. Drag pra sidebar limpa o prazo.
 */
export function CalendarioView({
  uid,
  tasks,
  projectMap,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  projects: Project[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
}) {
  const [reference, setReference] = useState<Date>(() => new Date());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const grid = useMemo(() => buildMonthGrid(reference), [reference]);
  const today = todayIso();

  const taskMap = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  // Tarefas com prazo, agrupadas por data.
  const tasksByDate = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (t.checked) continue;
      if (!t.deadline) continue;
      (m[t.deadline] ??= []).push(t);
    }
    // Ordena cada dia por score desc.
    for (const date of Object.keys(m)) {
      m[date]!.sort(
        (a, b) =>
          calcScore(b, projectMap[b.section] ?? null, ctx) -
          calcScore(a, projectMap[a.section] ?? null, ctx),
      );
    }
    return m;
  }, [tasks, projectMap, ctx]);

  // Sidebar: tarefas sem prazo, sorted by score.
  const sidebar = useMemo(() => {
    return tasks
      .filter((t) => !t.deadline && !t.checked)
      .map((t) => ({
        task: t,
        score: calcScore(t, projectMap[t.section] ?? null, ctx),
      }))
      .sort((a, b) => b.score - a.score);
  }, [tasks, projectMap, ctx]);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;

    const taskId = String(e.active.id);
    const task = taskMap[taskId];
    if (!task) return;

    if (overId === SIDEBAR_DROP_ID) {
      if (!task.deadline) return; // já está sem prazo
      await patchTask(uid, task, { deadline: '' });
      return;
    }
    if (overId.startsWith(DAY_DROP_PREFIX)) {
      const newDate = overId.slice(DAY_DROP_PREFIX.length);
      if (task.deadline === newDate) return;
      await patchTask(uid, task, { deadline: newDate });
    }
  }

  const activeTask = activeDragId ? taskMap[activeDragId] : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <section className="calendar-view">
        <CalendarSidebar items={sidebar} />

        <div className="calendar-main">
          <header className="calendar-nav">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setReference((r) => shiftMonth(r, -1))}
              aria-label="mês anterior"
            >
              ◀
            </button>
            <h2 className="calendar-title">{monthLabel(reference)}</h2>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setReference(new Date())}
            >
              Hoje
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setReference((r) => shiftMonth(r, 1))}
              aria-label="próximo mês"
            >
              ▶
            </button>
          </header>

          <div className="calendar-grid">
            {DAY_NAMES_SHORT.map((d) => (
              <div key={d} className="calendar-day-name">
                {d}
              </div>
            ))}
            {grid.map((cell) => {
              const cellTasks = tasksByDate[cell.iso] ?? [];
              const cls = [
                'calendar-cell',
                !cell.inMonth && 'out-of-month',
                cell.isToday && 'today',
                cell.isWeekend && 'weekend',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <DroppableDay
                  key={cell.iso}
                  id={`${DAY_DROP_PREFIX}${cell.iso}`}
                  className={cls}
                >
                  <div className="calendar-cell-head">
                    <span className="calendar-day-num">{cell.dayNum}</span>
                    {cell.isToday && <span className="muted calendar-today-tag">hoje</span>}
                  </div>
                  <div className="calendar-cell-body">
                    {cellTasks.slice(0, 6).map((t) => (
                      <MiniTaskItem key={t.id} task={t} />
                    ))}
                    {cellTasks.length > 6 && (
                      <span className="muted calendar-more">
                        +{cellTasks.length - 6}…
                      </span>
                    )}
                  </div>
                </DroppableDay>
              );
            })}
          </div>

          <p className="muted calendar-hint">
            Hoje: {today}. Arraste tarefas da sidebar para um dia para
            atribuir prazo; arraste pra sidebar pra limpar.
          </p>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="drag-overlay calendar-overlay">
              <MiniTaskItem task={activeTask} />
            </div>
          )}
        </DragOverlay>
      </section>
    </DndContext>
  );
}

function CalendarSidebar({
  items,
}: {
  items: Array<{ task: Task; score: number }>;
}) {
  return (
    <DroppableDay id={SIDEBAR_DROP_ID} className="calendar-sidebar">
      <header className="calendar-sidebar-head">
        <h3>Sem prazo</h3>
        <span className="muted">{items.length}</span>
      </header>
      <div className="calendar-sidebar-list">
        {items.length === 0 ? (
          <p className="muted">
            Nenhuma tarefa pendente sem prazo. Solte aqui pra remover prazo.
          </p>
        ) : (
          items.map(({ task, score }) => (
            <MiniTaskItem
              key={task.id}
              task={task}
              badge={<span className="mini-task-score">{score.toFixed(1)}</span>}
            />
          ))
        )}
      </div>
    </DroppableDay>
  );
}
