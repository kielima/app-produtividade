import { useEffect, useMemo, useState } from 'react';
import type { StatsFiltersState } from '../components/StatsFiltersBar';
import { subscribeToCompletedTasks } from '../repositories/tasksRepo';
import type {
  CompletedTask,
  Esforco,
  Modo,
  MoSCoW,
  Project,
} from '../types';

type Metric = StatsFiltersState['metric'];
type Dimension = StatsFiltersState['dimension'];

const DIMENSION_LABELS: Record<Dimension, string> = {
  moscow: 'MoSCoW',
  esforco: 'Esforço',
  modo: 'Modo',
};

type MoSCoWBucket = 'must' | 'should' | 'could' | 'wont';
const MOSCOW_ORDER: MoSCoWBucket[] = ['must', 'should', 'could', 'wont'];
const MOSCOW_LABELS: Record<MoSCoWBucket, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
};

type EsforcoBucket = 'rapido' | 'medio' | 'longo';
const ESFORCO_ORDER: EsforcoBucket[] = ['rapido', 'medio', 'longo'];
const ESFORCO_LABELS: Record<EsforcoBucket, string> = {
  rapido: 'Rápido',
  medio: 'Médio',
  longo: 'Longo',
};

type ModoBucket = 'manual' | 'colaborar' | 'delegar';
const MODO_ORDER: ModoBucket[] = ['manual', 'colaborar', 'delegar'];
const MODO_LABELS: Record<ModoBucket, string> = {
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
};

function bucketMoscow(m: MoSCoW): MoSCoWBucket {
  return !m ? 'could' : m;
}
function bucketEsforco(e: Esforco): EsforcoBucket {
  return !e ? 'rapido' : e;
}
function bucketModo(m: Modo): ModoBucket {
  return m || 'manual';
}

const MOSCOW_PTS: Record<MoSCoW, number> = {
  must: 3,
  should: 2,
  could: 1,
  wont: 0,
  '': 1,
};

const EFFORT_DIV: Record<Esforco, number> = {
  rapido: 1,
  medio: 2,
  longo: 3,
  '': 1,
};

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function intrinsicValue(
  task: CompletedTask,
  projectScoreMap: Record<string, number>,
): number {
  const sectionId = task.archivedFromSection || task.section;
  const projectScore = sectionId ? projectScoreMap[sectionId] ?? 0 : 0;
  const moscowPts = MOSCOW_PTS[task.moscow] ?? 1;
  const effortDiv = EFFORT_DIV[task.esforco] ?? 1;
  return (projectScore * moscowPts) / effortDiv;
}

interface Slot {
  count: number;
  score: number;
}

interface DayBucket {
  date: Date;
  key: string;
  count: number;
  score: number;
  byMoscow: Record<MoSCoWBucket, Slot>;
  byEsforco: Record<EsforcoBucket, Slot>;
  byModo: Record<ModoBucket, Slot>;
}

function emptySlot(): Slot {
  return { count: 0, score: 0 };
}

function emptyMoscowSlots(): Record<MoSCoWBucket, Slot> {
  return {
    must: emptySlot(),
    should: emptySlot(),
    could: emptySlot(),
    wont: emptySlot(),
  };
}

function emptyEsforcoSlots(): Record<EsforcoBucket, Slot> {
  return { rapido: emptySlot(), medio: emptySlot(), longo: emptySlot() };
}

function emptyModoSlots(): Record<ModoBucket, Slot> {
  return { manual: emptySlot(), colaborar: emptySlot(), delegar: emptySlot() };
}

function buildDailyBuckets(
  tasks: CompletedTask[],
  projectScoreMap: Record<string, number>,
  rangeDays: number,
): DayBucket[] {
  const today = startOfDay(new Date());
  const buckets: DayBucket[] = [];
  const index = new Map<string, DayBucket>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const b: DayBucket = {
      date: d,
      key: dayKey(d),
      count: 0,
      score: 0,
      byMoscow: emptyMoscowSlots(),
      byEsforco: emptyEsforcoSlots(),
      byModo: emptyModoSlots(),
    };
    buckets.push(b);
    index.set(b.key, b);
  }
  for (const t of tasks) {
    if (!t.archivedAt) continue;
    const k = dayKey(startOfDay(t.archivedAt));
    const b = index.get(k);
    if (!b) continue;
    const v = intrinsicValue(t, projectScoreMap);
    b.count += 1;
    b.score += v;
    const ms = b.byMoscow[bucketMoscow(t.moscow)];
    ms.count += 1;
    ms.score += v;
    const es = b.byEsforco[bucketEsforco(t.esforco)];
    es.count += 1;
    es.score += v;
    const mo = b.byModo[bucketModo(t.modo)];
    mo.count += 1;
    mo.score += v;
  }
  return buckets;
}

type Granularity = 'day' | 'week';

function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() - c.getDay());
  return c;
}

// ISO 8601: semanas começam na segunda; semana 1 contém a primeira quinta-feira
// do ano. Cobre o caso dos primeiros/últimos dias do ano caírem em semana do
// ano anterior/seguinte.
function isoWeekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function aggregateBucketsToWeeks(daily: DayBucket[]): DayBucket[] {
  const weeks: DayBucket[] = [];
  const byKey = new Map<string, DayBucket>();
  for (const day of daily) {
    const wStart = startOfWeek(day.date);
    const k = dayKey(wStart);
    let w = byKey.get(k);
    if (!w) {
      w = {
        date: wStart,
        key: k,
        count: 0,
        score: 0,
        byMoscow: emptyMoscowSlots(),
        byEsforco: emptyEsforcoSlots(),
        byModo: emptyModoSlots(),
      };
      byKey.set(k, w);
      weeks.push(w);
    }
    w.count += day.count;
    w.score += day.score;
    for (const c of MOSCOW_ORDER) {
      w.byMoscow[c].count += day.byMoscow[c].count;
      w.byMoscow[c].score += day.byMoscow[c].score;
    }
    for (const c of ESFORCO_ORDER) {
      w.byEsforco[c].count += day.byEsforco[c].count;
      w.byEsforco[c].score += day.byEsforco[c].score;
    }
    for (const c of MODO_ORDER) {
      w.byModo[c].count += day.byModo[c].count;
      w.byModo[c].score += day.byModo[c].score;
    }
  }
  return weeks;
}

function dimensionSlots(b: DayBucket, dim: Dimension): Record<string, Slot> {
  if (dim === 'moscow') return b.byMoscow;
  if (dim === 'esforco') return b.byEsforco;
  return b.byModo;
}

function dimensionOrder(dim: Dimension): readonly string[] {
  if (dim === 'moscow') return MOSCOW_ORDER;
  if (dim === 'esforco') return ESFORCO_ORDER;
  return MODO_ORDER;
}

function dimensionCategoryLabel(dim: Dimension, cat: string): string {
  if (dim === 'moscow') return MOSCOW_LABELS[cat as MoSCoWBucket];
  if (dim === 'esforco') return ESFORCO_LABELS[cat as EsforcoBucket];
  return MODO_LABELS[cat as ModoBucket];
}

interface HeatmapProps {
  buckets: DayBucket[];
  metric: Metric;
}

function Heatmap({ buckets, metric }: HeatmapProps) {
  const max = Math.max(
    0,
    ...buckets.map((b) => (metric === 'count' ? b.count : b.score)),
  );

  function level(value: number): number {
    if (value < 0) return -1;
    if (value === 0) return 0;
    if (max === 0) return 0;
    const ratio = value / max;
    if (ratio > 0.66) return 4;
    if (ratio > 0.33) return 3;
    if (ratio > 0.1) return 2;
    return 1;
  }

  function cellTitle(date: Date, value: number): string {
    return `${formatBR(date)} — ${value.toFixed(metric === 'score' ? 1 : 0)} ${
      metric === 'count' ? 'tarefas' : 'pts'
    }`;
  }

  // Para ranges curtos (≤ 7 dias), uma linha horizontal é muito mais
  // legível que o calendário 7-rows — que ficaria 1 coluna gigante.
  if (buckets.length <= 7) {
    return (
      <div
        className="stats-heatmap stats-heatmap--row"
        role="grid"
        aria-label="Heatmap de tarefas concluídas"
      >
        {buckets.map((b) => {
          const v = metric === 'count' ? b.count : b.score;
          const lvl = level(v);
          const title = cellTitle(b.date, v);
          return (
            <div
              key={b.key}
              className={`stats-heatmap-cell stats-heatmap-cell--${lvl}`}
              title={title}
              aria-label={title}
              role="gridcell"
            />
          );
        })}
      </div>
    );
  }

  const today = startOfDay(new Date());
  const anchor = new Date(today);
  anchor.setDate(anchor.getDate() - anchor.getDay());

  const weeksToShow = Math.ceil(buckets.length / 7);
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  const cells: Array<{ key: string; value: number; date: Date | null }> = [];
  for (let col = weeksToShow - 1; col >= 0; col--) {
    for (let row = 0; row < 7; row++) {
      const d = new Date(anchor);
      d.setDate(d.getDate() - col * 7 + row);
      const k = dayKey(d);
      const b = byKey.get(k);
      const value = b ? (metric === 'count' ? b.count : b.score) : 0;
      const inRange = d <= today && b != null;
      cells.push({
        key: `${col}-${row}`,
        value: inRange ? value : -1,
        date: inRange ? d : null,
      });
    }
  }

  return (
    <div
      className="stats-heatmap"
      style={{ gridTemplateColumns: `repeat(${weeksToShow}, 1fr)` }}
      role="grid"
      aria-label="Heatmap de tarefas concluídas"
    >
      {cells.map((c) => {
        const lvl = level(c.value);
        const title = c.date ? cellTitle(c.date, c.value) : '';
        return (
          <div
            key={c.key}
            className={`stats-heatmap-cell stats-heatmap-cell--${lvl}`}
            title={title}
            aria-label={title}
            role="gridcell"
          />
        );
      })}
    </div>
  );
}

interface BarsProps {
  buckets: DayBucket[];
  metric: Metric;
  dimension: Dimension;
  granularity: Granularity;
}

function slotValue(slot: Slot | undefined, metric: Metric): number {
  if (!slot) return 0;
  return metric === 'count' ? slot.count : slot.score;
}

function DailyBars({ buckets, metric, dimension, granularity }: BarsProps) {
  const max = Math.max(
    1,
    ...buckets.map((b) => (metric === 'count' ? b.count : b.score)),
  );
  // Labels horizontais ocupam mais espaço que rotacionados — mais espaçamento.
  const labelEvery =
    buckets.length > 60
      ? 30
      : buckets.length > 30
        ? 10
        : buckets.length > 14
          ? 5
          : 1;
  const unit = metric === 'count' ? 'tarefas' : 'pts';
  const digits = metric === 'score' ? 1 : 0;
  const order = dimensionOrder(dimension);
  const periodWord = granularity === 'week' ? 'semana' : 'dia';

  return (
    <div
      className="stats-bars"
      role="img"
      aria-label={`Gráfico de barras por ${periodWord}, empilhado por ${DIMENSION_LABELS[dimension]}`}
    >
      {buckets.map((b, i) => {
        const total = metric === 'count' ? b.count : b.score;
        const heightPct = (total / max) * 100;
        // Mostra a cada labelEvery; força o último apenas com folga
        // suficiente do rótulo anterior (evita S18+S20 colando no anual).
        const offset = i % labelEvery;
        const showLabel =
          offset === 0 ||
          (i === buckets.length - 1 &&
            offset >= Math.max(2, Math.ceil(labelEvery / 2)));
        const slots = dimensionSlots(b, dimension);
        const breakdown = order
          .map((c) => {
            const v = slotValue(slots[c], metric);
            return v > 0
              ? `\n  ${dimensionCategoryLabel(dimension, c)}: ${v.toFixed(digits)}`
              : '';
          })
          .join('');
        const dateLabel =
          granularity === 'week'
            ? `Semana ${isoWeekNumber(b.date)} (a partir de ${formatBR(b.date)})`
            : formatBR(b.date);
        const title =
          `${dateLabel} — ${total.toFixed(digits)} ${unit}` + breakdown;
        return (
          <div key={b.key} className="stats-bar-col" title={title}>
            <div className="stats-bar-track">
              <div
                className="stats-bar-stack"
                style={{ height: `${heightPct}%` }}
              >
                {order.map((c) => {
                  const v = slotValue(slots[c], metric);
                  if (v <= 0) return null;
                  return (
                    <div
                      key={c}
                      className={`stats-bar-seg stats-bar-seg--${dimension}-${c}`}
                      style={{ flexGrow: v }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="stats-bar-label">
              {showLabel
                ? granularity === 'week'
                  ? `S${isoWeekNumber(b.date)}`
                  : b.date.toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                    })
                : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DimensionLegend({ dimension }: { dimension: Dimension }) {
  const order = dimensionOrder(dimension);
  return (
    <ul
      className="stats-legend"
      aria-label={`Legenda ${DIMENSION_LABELS[dimension]}`}
    >
      {order.map((c) => (
        <li key={c} className="stats-legend-item">
          <span
            className={`stats-legend-swatch stats-legend-swatch--${dimension}-${c}`}
            aria-hidden="true"
          />
          {dimensionCategoryLabel(dimension, c)}
        </li>
      ))}
    </ul>
  );
}

interface ProjectAgg {
  id: string;
  name: string;
  count: number;
  score: number;
}

interface ProjectBreakdownProps {
  tasks: CompletedTask[];
  projectNameById: Map<string, string>;
  projectScoreMap: Record<string, number>;
  metric: Metric;
}

function ProjectBreakdown({
  tasks,
  projectNameById,
  projectScoreMap,
  metric,
}: ProjectBreakdownProps) {
  const aggs = useMemo<ProjectAgg[]>(() => {
    const m = new Map<string, ProjectAgg>();
    const snapshotName = new Map<string, string>();
    for (const t of tasks) {
      const id = t.archivedFromSection || t.section || '';
      const v = intrinsicValue(t, projectScoreMap);
      const entry = m.get(id) ?? { id, name: '', count: 0, score: 0 };
      entry.count += 1;
      entry.score += v;
      m.set(id, entry);
      if (id && t.archivedFromSectionName && !snapshotName.has(id)) {
        snapshotName.set(id, t.archivedFromSectionName);
      }
    }
    // Resolve nome final: projeto ativo > snapshot do arquivamento > placeholder
    for (const entry of m.values()) {
      if (!entry.id) {
        entry.name = 'Sem projeto';
      } else {
        entry.name =
          projectNameById.get(entry.id) ??
          snapshotName.get(entry.id) ??
          '(projeto removido)';
      }
    }
    return [...m.values()]
      .sort((a, b) => {
        const av = metric === 'count' ? a.count : a.score;
        const bv = metric === 'count' ? b.count : b.score;
        return bv - av;
      })
      .slice(0, 10);
  }, [tasks, projectNameById, projectScoreMap, metric]);

  if (aggs.length === 0) return null;
  const max = Math.max(
    1,
    ...aggs.map((a) => (metric === 'count' ? a.count : a.score)),
  );
  const digits = metric === 'score' ? 1 : 0;

  return (
    <ul className="stats-project-list">
      {aggs.map((a) => {
        const v = metric === 'count' ? a.count : a.score;
        const pct = (v / max) * 100;
        return (
          <li key={a.id || '__nosec'} className="stats-project-row">
            <div className="stats-project-name" title={a.name}>
              {a.name}
            </div>
            <div className="stats-project-track">
              <div
                className="stats-project-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="stats-project-value">{v.toFixed(digits)}</div>
          </li>
        );
      })}
    </ul>
  );
}

type DeltaSign = 'up' | 'down' | 'flat';
interface Delta {
  pct: number | null;
  sign: DeltaSign;
}

function pctDelta(curr: number, prev: number): Delta {
  if (prev === 0) return { pct: null, sign: 'flat' };
  const d = ((curr - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) return { pct: 0, sign: 'flat' };
  return { pct: d, sign: d > 0 ? 'up' : 'down' };
}

function DeltaBadge({ delta }: { delta: Delta }) {
  if (delta.pct == null) return null;
  const sign = delta.pct > 0 ? '+' : '';
  return (
    <span
      className={`stats-card-delta stats-card-delta--${delta.sign}`}
      title="Variação vs período anterior de mesmo tamanho"
    >
      {sign}
      {delta.pct.toFixed(0)}%
    </span>
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface EstatisticasViewProps {
  uid: string;
  projects: Project[];
  projectScoreMap: Record<string, number>;
  filters: StatsFiltersState;
}

export function EstatisticasView({
  uid,
  projects,
  projectScoreMap,
  filters,
}: EstatisticasViewProps) {
  const { range, metric, dimension, projectFilter } = filters;
  const [tasks, setTasks] = useState<CompletedTask[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToCompletedTasks(
      uid,
      (next) => {
        setTasks(next);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
  }, [uid]);

  const filteredTasks = useMemo(() => {
    if (!projectFilter) return tasks;
    return tasks.filter(
      (t) => (t.archivedFromSection || t.section) === projectFilter,
    );
  }, [tasks, projectFilter]);

  const rangeDays = parseInt(range, 10);
  const buckets = useMemo(
    () => buildDailyBuckets(filteredTasks, projectScoreMap, rangeDays),
    [filteredTasks, projectScoreMap, rangeDays],
  );
  const granularity: Granularity = rangeDays >= 90 ? 'week' : 'day';
  const barBuckets = useMemo(
    () => (granularity === 'week' ? aggregateBucketsToWeeks(buckets) : buckets),
    [buckets, granularity],
  );

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const stats = useMemo(() => {
    let count = 0;
    let score = 0;
    let bestDay: DayBucket | null = null;
    let longestStreak = 0;
    let current = 0;
    for (const b of buckets) {
      count += b.count;
      score += b.score;
      const v = metric === 'count' ? b.count : b.score;
      const bestV = bestDay
        ? metric === 'count'
          ? bestDay.count
          : bestDay.score
        : -1;
      if (v > bestV) bestDay = b;
      if (b.count > 0) {
        current += 1;
        if (current > longestStreak) longestStreak = current;
      } else {
        current = 0;
      }
    }

    const today = startOfDay(new Date());
    const periodStart = new Date(today);
    periodStart.setDate(periodStart.getDate() - rangeDays + 1);

    const periodTasks: CompletedTask[] = [];
    const cycleDays: number[] = [];
    let withDeadline = 0;
    let onTime = 0;
    for (const t of filteredTasks) {
      if (!t.archivedAt) continue;
      const at = startOfDay(t.archivedAt);
      if (at < periodStart || at > today) continue;
      periodTasks.push(t);
      if (t.addedDate) {
        const added = startOfDay(new Date(t.addedDate));
        const days = Math.round(
          (at.getTime() - added.getTime()) / 86400000,
        );
        if (Number.isFinite(days) && days >= 0) cycleDays.push(days);
      }
      if (t.deadline) {
        const dl = startOfDay(new Date(t.deadline));
        if (!Number.isNaN(dl.getTime())) {
          withDeadline += 1;
          if (at <= dl) onTime += 1;
        }
      }
    }

    return {
      count,
      score,
      bestDay,
      avgPerDay: count / buckets.length,
      longestStreak,
      medianCycle: median(cycleDays),
      onTimePct: withDeadline > 0 ? (onTime / withDeadline) * 100 : null,
      withDeadline,
      periodTasks,
    };
  }, [buckets, filteredTasks, metric, rangeDays]);

  const prevTotals = useMemo(() => {
    const today = startOfDay(new Date());
    const currStart = new Date(today);
    currStart.setDate(currStart.getDate() - rangeDays + 1);
    const prevEnd = new Date(currStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - rangeDays + 1);
    let count = 0;
    let score = 0;
    for (const t of filteredTasks) {
      if (!t.archivedAt) continue;
      const at = startOfDay(t.archivedAt);
      if (at < prevStart || at > prevEnd) continue;
      count += 1;
      score += intrinsicValue(t, projectScoreMap);
    }
    return { count, score };
  }, [filteredTasks, projectScoreMap, rangeDays]);

  const currTotal = metric === 'count' ? stats.count : stats.score;
  const prevTotal = metric === 'count' ? prevTotals.count : prevTotals.score;
  const totalDelta = pctDelta(currTotal, prevTotal);

  if (error) {
    return (
      <section className="estatisticas-view">
        <p role="alert" className="error">
          Erro ao carregar estatísticas: {error.message}
        </p>
      </section>
    );
  }

  const showProjectBreakdown = !projectFilter && stats.periodTasks.length > 0;

  return (
    <section className="estatisticas-view">
      <div className="stats-summary">
        <div className="stats-card">
          <span className="stats-card-label">Total no período</span>
          <span className="stats-card-value">
            {metric === 'count' ? stats.count : stats.score.toFixed(1)}
            <small>{metric === 'count' ? ' tarefas' : ' pts'}</small>
            <DeltaBadge delta={totalDelta} />
          </span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Média / dia</span>
          <span className="stats-card-value">
            {metric === 'count'
              ? stats.avgPerDay.toFixed(1)
              : (stats.score / buckets.length).toFixed(1)}
          </span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Melhor dia</span>
          <span className="stats-card-value">
            {stats.bestDay && stats.bestDay.count > 0 ? (
              <>
                {metric === 'count'
                  ? stats.bestDay.count
                  : stats.bestDay.score.toFixed(1)}
                <small> · {formatBR(stats.bestDay.date)}</small>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Maior streak</span>
          <span className="stats-card-value">
            {stats.longestStreak > 0 ? (
              <>
                {stats.longestStreak}
                <small> dias seguidos</small>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Mediana de ciclo</span>
          <span className="stats-card-value">
            {stats.medianCycle != null ? (
              <>
                {stats.medianCycle.toFixed(stats.medianCycle < 10 ? 1 : 0)}
                <small> dias</small>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">No prazo</span>
          <span className="stats-card-value">
            {stats.onTimePct != null ? (
              <>
                {stats.onTimePct.toFixed(0)}
                <small>% · {stats.withDeadline} c/ deadline</small>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
      </div>

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">
          Você ainda não concluiu nenhuma tarefa. Conclua uma e ela aparece
          aqui no próximo carregamento.
        </p>
      ) : filteredTasks.length === 0 ? (
        <p className="muted">Nenhuma tarefa concluída neste projeto.</p>
      ) : (
        <>
          <div className="stats-section">
            <h3 className="stats-section-title">Atividade</h3>
            <Heatmap buckets={buckets} metric={metric} />
          </div>

          <div className="stats-section">
            <h3 className="stats-section-title">
              {metric === 'count' ? 'Tarefas' : 'Score'} por{' '}
              {granularity === 'week' ? 'semana' : 'dia'}
              <small className="stats-section-sub">
                {' '}
                · empilhado por {DIMENSION_LABELS[dimension]}
              </small>
            </h3>
            <DailyBars
              buckets={barBuckets}
              metric={metric}
              dimension={dimension}
              granularity={granularity}
            />
            <DimensionLegend dimension={dimension} />
          </div>

          {showProjectBreakdown && (
            <div className="stats-section">
              <h3 className="stats-section-title">
                Por projeto · top 10
              </h3>
              <ProjectBreakdown
                tasks={stats.periodTasks}
                projectNameById={projectNameById}
                projectScoreMap={projectScoreMap}
                metric={metric}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
