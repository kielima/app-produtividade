import { useMemo } from 'react';
import { buildGanttData, ganttMonthTicks, ganttPositionPct } from '../lib/gantt';
import type { GanttBar } from '../lib/gantt';
import { useTaskNavigation } from '../lib/taskNavigation';
import type { Project, ScoreContext, Task } from '../types';

function BarRow({
  bar,
  rangeStart,
  rangeEnd,
  todayPct,
  onOpen,
}: {
  bar: GanttBar;
  rangeStart: Date;
  rangeEnd: Date;
  todayPct: number | null;
  onOpen: (taskId: string) => void;
}) {
  const startPct = ganttPositionPct(bar.start, rangeStart, rangeEnd);
  const endPct = ganttPositionPct(bar.end, rangeStart, rangeEnd);
  const moscowClass = bar.moscow ? `gantt-bar--moscow-${bar.moscow}` : 'gantt-bar--moscow-none';

  return (
    <div className="gantt-row">
      <button
        type="button"
        className="gantt-row-label"
        onClick={() => onOpen(bar.taskId)}
        title={bar.displayTitle}
      >
        {bar.blocked && <span aria-hidden="true">🔒 </span>}
        {bar.displayTitle}
      </button>
      <div className="gantt-track">
        {todayPct !== null && (
          <span className="gantt-today-line" style={{ left: `${todayPct}%` }} aria-hidden="true" />
        )}
        {bar.isMilestone ? (
          <button
            type="button"
            className={`gantt-milestone ${moscowClass}${bar.checked ? ' gantt-bar--done' : ''}`}
            style={{ left: `${startPct}%` }}
            onClick={() => onOpen(bar.taskId)}
            title={bar.displayTitle}
            aria-label={`Abrir tarefa: ${bar.displayTitle}`}
          />
        ) : (
          <button
            type="button"
            className={`gantt-bar ${moscowClass}${bar.checked ? ' gantt-bar--done' : ''}${
              bar.openEnded ? ' gantt-bar--open-ended' : ''
            }${bar.blocked ? ' gantt-bar--blocked' : ''}`}
            style={{ left: `${startPct}%`, width: `${Math.max(endPct - startPct, 0.5)}%` }}
            onClick={() => onOpen(bar.taskId)}
            title={bar.displayTitle}
            aria-label={`Abrir tarefa: ${bar.displayTitle}`}
          />
        )}
      </div>
    </div>
  );
}

export function GanttView({
  tasks,
  projectMap,
  ctx,
}: {
  tasks: Task[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
}) {
  const { openTask } = useTaskNavigation();
  const today = useMemo(() => new Date(), []);
  const data = useMemo(
    () => buildGanttData(tasks, projectMap, ctx, today),
    [tasks, projectMap, ctx, today],
  );
  const ticks = useMemo(
    () => ganttMonthTicks(data.rangeStart, data.rangeEnd),
    [data.rangeStart, data.rangeEnd],
  );
  const rawTodayPct =
    today >= data.rangeStart && today <= data.rangeEnd
      ? ganttPositionPct(today, data.rangeStart, data.rangeEnd)
      : null;

  if (data.groups.length === 0) {
    return (
      <section className="gantt-view">
        <p className="muted">
          Nenhuma tarefa com data (início ou prazo) pra desenhar o Gantt.
          {data.unscheduledCount > 0 &&
            ` (${data.unscheduledCount} tarefa(s) sem nenhuma data.)`}
        </p>
      </section>
    );
  }

  return (
    <section className="gantt-view">
      <div className="gantt-scroll">
        <div className="gantt-chart">
          <div className="gantt-axis">
            <div className="gantt-row-label gantt-axis-spacer" aria-hidden="true" />
            <div className="gantt-track gantt-axis-track">
              {ticks.map((t) => (
                <span
                  key={t.date.toISOString()}
                  className="gantt-tick"
                  style={{ left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ))}
              {rawTodayPct !== null && (
                <span
                  className="gantt-today-line"
                  style={{ left: `${rawTodayPct}%` }}
                  title="Hoje"
                />
              )}
            </div>
          </div>
          {data.groups.map((group) => (
            <div className="gantt-group" key={group.projectId}>
              <h3 className="gantt-group-title">{group.projectName}</h3>
              {group.bars.map((bar) => (
                <BarRow
                  key={bar.taskId}
                  bar={bar}
                  rangeStart={data.rangeStart}
                  rangeEnd={data.rangeEnd}
                  todayPct={rawTodayPct}
                  onOpen={openTask}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {data.unscheduledCount > 0 && (
        <p className="muted gantt-unscheduled-note">
          {data.unscheduledCount} tarefa(s) sem data (nem início, nem prazo) não aparecem aqui.
        </p>
      )}
    </section>
  );
}
