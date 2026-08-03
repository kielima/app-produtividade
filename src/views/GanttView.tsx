import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  buildGanttData,
  computeGanttEdges,
  ganttMonthTicks,
  ganttPositionPct,
} from '../lib/gantt';
import type { GanttBar, GanttEdge } from '../lib/gantt';
import { useTaskNavigation } from '../lib/taskNavigation';
import type { Project, ScoreContext, Task } from '../types';

interface EdgePath {
  id: string;
  d: string;
  resolved: boolean;
}

function BarRow({
  bar,
  rangeStart,
  rangeEnd,
  todayPct,
  onOpen,
  registerEl,
}: {
  bar: GanttBar;
  rangeStart: Date;
  rangeEnd: Date;
  todayPct: number | null;
  onOpen: (taskId: string) => void;
  registerEl: (taskId: string, el: HTMLElement | null) => void;
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
            ref={(el) => registerEl(bar.taskId, el)}
            type="button"
            className={`gantt-milestone ${moscowClass}${bar.checked ? ' gantt-bar--done' : ''}`}
            style={{ left: `${startPct}%` }}
            onClick={() => onOpen(bar.taskId)}
            title={bar.displayTitle}
            aria-label={`Abrir tarefa: ${bar.displayTitle}`}
          />
        ) : (
          <button
            ref={(el) => registerEl(bar.taskId, el)}
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

/**
 * Overlay de setas ligando bloqueadora → bloqueada, no estilo clássico de
 * Gantt. As barras já são posicionadas por CSS (%), então pra desenhar uma
 * linha entre duas barras que podem estar em grupos/linhas diferentes é
 * preciso medir a posição real em pixels pós-layout (getBoundingClientRect),
 * daí o useLayoutEffect + refs em vez de tentar calcular tudo em CSS puro.
 */
function EdgeOverlay({
  edges,
  elMap,
  containerRef,
  version,
}: {
  edges: GanttEdge[];
  elMap: Map<string, HTMLElement>;
  containerRef: RefObject<HTMLDivElement>;
  version: number;
}) {
  const markerId = useId();
  const [paths, setPaths] = useState<EdgePath[]>([]);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const next: EdgePath[] = [];
    for (const edge of edges) {
      const fromEl = elMap.get(edge.fromId);
      const toEl = elMap.get(edge.toId);
      if (!fromEl || !toEl) continue;
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const fromX = fromRect.right - containerRect.left;
      const fromY = fromRect.top - containerRect.top + fromRect.height / 2;
      const toX = toRect.left - containerRect.left;
      const toY = toRect.top - containerRect.top + toRect.height / 2;
      // Curva em "S" com tangente horizontal nas pontas — lê bem tanto
      // quando a bloqueada está à frente (caso comum) quanto atrás (datas
      // fora de ordem), sem precisar de roteamento ortogonal.
      const dx = Math.max(Math.abs(toX - fromX) * 0.5, 24);
      const d = `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
      next.push({ id: `${edge.fromId}→${edge.toId}`, d, resolved: edge.resolved });
    }
    setPaths(next);
  }, [edges, elMap, containerRef]);

  useLayoutEffect(() => {
    recompute();
    // `version` muda a cada render do gráfico (refs podem ter sido
    // registrados/trocados desde a última medição).
  }, [recompute, version]);

  useEffect(() => {
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [recompute]);

  return (
    <svg className="gantt-edges" aria-hidden="true">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {paths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          className={`gantt-edge${p.resolved ? ' gantt-edge--resolved' : ''}`}
          markerEnd={`url(#${markerId})`}
        />
      ))}
    </svg>
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
  const edges = useMemo(() => computeGanttEdges(data.groups, ctx), [data.groups, ctx]);
  const ticks = useMemo(
    () => ganttMonthTicks(data.rangeStart, data.rangeEnd),
    [data.rangeStart, data.rangeEnd],
  );
  const rawTodayPct =
    today >= data.rangeStart && today <= data.rangeEnd
      ? ganttPositionPct(today, data.rangeStart, data.rangeEnd)
      : null;

  const chartRef = useRef<HTMLDivElement>(null);
  const elMapRef = useRef(new Map<string, HTMLElement>());
  const [renderVersion, setRenderVersion] = useState(0);
  const registerEl = useCallback((taskId: string, el: HTMLElement | null) => {
    if (el) elMapRef.current.set(taskId, el);
    else elMapRef.current.delete(taskId);
  }, []);
  // As barras (refs) só terminam de montar depois deste render — força o
  // overlay de setas a remedir na próxima passada.
  useLayoutEffect(() => {
    setRenderVersion((v) => v + 1);
  }, [data]);

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
        <div className="gantt-chart" ref={chartRef}>
          <EdgeOverlay edges={edges} elMap={elMapRef.current} containerRef={chartRef} version={renderVersion} />
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
                  registerEl={registerEl}
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
      {edges.length > 0 && (
        <p className="muted gantt-edges-note">
          {edges.length} conexão(ões) de dependência desenhada(s). Bloqueios ainda ativos aparecem
          em vermelho; dependências já resolvidas, em cinza.
        </p>
      )}
    </section>
  );
}
