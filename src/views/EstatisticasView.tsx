import { useEffect, useMemo, useState } from 'react';
import { ProjectCombobox } from '../components/TaskFiltersBar';
import { subscribeToCompletedTasks } from '../repositories/tasksRepo';
import type { CompletedTask, Esforco, MoSCoW, Project } from '../types';

type RangeKey = '7' | '30' | '90' | '365';
type Metric = 'count' | 'score';
type MoSCoWBucket = 'must' | 'should' | 'could' | 'wont';

const RANGE_LABELS: Record<RangeKey, string> = {
  '7': '7 dias',
  '30': '30 dias',
  '90': '90 dias',
  '365': '1 ano',
};

// Ordem visual de baixo pra cima na barra empilhada — must é a base.
const MOSCOW_ORDER: MoSCoWBucket[] = ['must', 'should', 'could', 'wont'];

const MOSCOW_LABELS: Record<MoSCoWBucket, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
};

// MoSCoW vazio cai em "could" — mesmo peso (1 pt) no score, sem precisar
// de um 5º bucket com cor própria.
function bucketize(m: MoSCoW): MoSCoWBucket {
  if (m === '' || m == null) return 'could';
  return m;
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

interface MoscowSlot {
  count: number;
  score: number;
}

interface DayBucket {
  date: Date;
  key: string;
  count: number;
  score: number;
  byMoscow: Record<MoSCoWBucket, MoscowSlot>;
}

function emptySlots(): Record<MoSCoWBucket, MoscowSlot> {
  return {
    must: { count: 0, score: 0 },
    should: { count: 0, score: 0 },
    could: { count: 0, score: 0 },
    wont: { count: 0, score: 0 },
  };
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
      byMoscow: emptySlots(),
    };
    buckets.push(b);
    index.set(b.key, b);
  }
  for (const t of tasks) {
    if (!t.archivedAt) continue;
    const k = dayKey(startOfDay(t.archivedAt));
    const b = index.get(k);
    if (!b) continue;
    const value = intrinsicValue(t, projectScoreMap);
    const slot = b.byMoscow[bucketize(t.moscow)];
    b.count += 1;
    b.score += value;
    slot.count += 1;
    slot.score += value;
  }
  return buckets;
}

interface HeatmapProps {
  buckets: DayBucket[];
  metric: Metric;
}

function Heatmap({ buckets, metric }: HeatmapProps) {
  const today = startOfDay(new Date());
  // Domingo da semana atual como âncora à direita
  const anchor = new Date(today);
  anchor.setDate(anchor.getDate() - anchor.getDay());

  // Quantas semanas mostrar (sempre múltiplo de 7 dias para fechar colunas)
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

  const max = Math.max(0, ...cells.map((c) => (c.value > 0 ? c.value : 0)));

  function level(value: number): number {
    if (value < 0) return -1; // fora do range
    if (value === 0) return 0;
    if (max === 0) return 0;
    const ratio = value / max;
    if (ratio > 0.66) return 4;
    if (ratio > 0.33) return 3;
    if (ratio > 0.1) return 2;
    return 1;
  }

  return (
    <div
      className="stats-heatmap"
      style={{
        gridTemplateColumns: `repeat(${weeksToShow}, 1fr)`,
      }}
      role="grid"
      aria-label="Heatmap de tarefas concluídas"
    >
      {cells.map((c) => {
        const lvl = level(c.value);
        const title = c.date
          ? `${formatBR(c.date)} — ${c.value.toFixed(metric === 'score' ? 1 : 0)} ${
              metric === 'count' ? 'tarefas' : 'pts'
            }`
          : '';
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
}

function slotValue(slot: MoscowSlot, metric: Metric): number {
  return metric === 'count' ? slot.count : slot.score;
}

function DailyBars({ buckets, metric }: BarsProps) {
  const max = Math.max(
    1,
    ...buckets.map((b) => (metric === 'count' ? b.count : b.score)),
  );
  // Mostra labels só em alguns dias pra não poluir
  const labelEvery =
    buckets.length > 60 ? 14 : buckets.length > 30 ? 7 : buckets.length > 14 ? 3 : 1;
  const unit = metric === 'count' ? 'tarefas' : 'pts';
  const digits = metric === 'score' ? 1 : 0;

  return (
    <div
      className="stats-bars"
      role="img"
      aria-label="Gráfico de barras por dia"
    >
      {buckets.map((b, i) => {
        const total = metric === 'count' ? b.count : b.score;
        const heightPct = (total / max) * 100;
        const showLabel = i % labelEvery === 0 || i === buckets.length - 1;
        const breakdown = MOSCOW_ORDER.map((m) => {
          const v = slotValue(b.byMoscow[m], metric);
          return v > 0 ? `\n  ${MOSCOW_LABELS[m]}: ${v.toFixed(digits)}` : '';
        }).join('');
        const title =
          `${formatBR(b.date)} — ${total.toFixed(digits)} ${unit}` + breakdown;
        return (
          <div key={b.key} className="stats-bar-col" title={title}>
            <div className="stats-bar-track">
              <div
                className="stats-bar-stack"
                style={{ height: `${heightPct}%` }}
              >
                {MOSCOW_ORDER.map((m) => {
                  const v = slotValue(b.byMoscow[m], metric);
                  if (v <= 0) return null;
                  return (
                    <div
                      key={m}
                      className={`stats-bar-seg stats-bar-seg--${m}`}
                      style={{ flexGrow: v }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="stats-bar-label">
              {showLabel
                ? b.date.toLocaleDateString('pt-BR', {
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

function MoscowLegend() {
  return (
    <ul className="stats-legend" aria-label="Legenda MoSCoW">
      {MOSCOW_ORDER.map((m) => (
        <li key={m} className="stats-legend-item">
          <span
            className={`stats-legend-swatch stats-legend-swatch--${m}`}
            aria-hidden="true"
          />
          {MOSCOW_LABELS[m]}
        </li>
      ))}
    </ul>
  );
}

interface EstatisticasViewProps {
  uid: string;
  projects: Project[];
  projectScoreMap: Record<string, number>;
}

export function EstatisticasView({
  uid,
  projects,
  projectScoreMap,
}: EstatisticasViewProps) {
  const [tasks, setTasks] = useState<CompletedTask[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>('90');
  const [metric, setMetric] = useState<Metric>('count');
  const [projectFilter, setProjectFilter] = useState<string>('');

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

  const buckets = useMemo(
    () => buildDailyBuckets(filteredTasks, projectScoreMap, parseInt(range, 10)),
    [filteredTasks, projectScoreMap, range],
  );

  const totals = useMemo(() => {
    let count = 0;
    let score = 0;
    let bestDay: DayBucket | null = null;
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
    }
    const avgPerDay = count / buckets.length;
    return { count, score, bestDay, avgPerDay };
  }, [buckets, metric]);

  if (error) {
    return (
      <section className="estatisticas-view">
        <p role="alert" className="error">
          Erro ao carregar estatísticas: {error.message}
        </p>
      </section>
    );
  }

  return (
    <section className="estatisticas-view">
      <div className="stats-controls" role="toolbar" aria-label="Controles">
        <div className="stats-control-group" role="radiogroup" aria-label="Período">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={range === k}
              className={`stats-chip ${range === k ? 'stats-chip--active' : ''}`}
              onClick={() => setRange(k)}
            >
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="stats-control-group" role="radiogroup" aria-label="Métrica">
          <button
            type="button"
            role="radio"
            aria-checked={metric === 'count'}
            className={`stats-chip ${metric === 'count' ? 'stats-chip--active' : ''}`}
            onClick={() => setMetric('count')}
          >
            Contagem
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={metric === 'score'}
            className={`stats-chip ${metric === 'score' ? 'stats-chip--active' : ''}`}
            onClick={() => setMetric('score')}
          >
            Score
          </button>
        </div>
        <div className="stats-project-filter" aria-label="Filtrar por projeto">
          <ProjectCombobox
            value={projectFilter}
            onChange={setProjectFilter}
            projects={projects}
          />
        </div>
      </div>

      <div className="stats-summary">
        <div className="stats-card">
          <span className="stats-card-label">Total no período</span>
          <span className="stats-card-value">
            {metric === 'count'
              ? totals.count
              : totals.score.toFixed(1)}
            <small>{metric === 'count' ? ' tarefas' : ' pts'}</small>
          </span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Média / dia</span>
          <span className="stats-card-value">
            {metric === 'count'
              ? totals.avgPerDay.toFixed(1)
              : (totals.score / buckets.length).toFixed(1)}
          </span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Melhor dia</span>
          <span className="stats-card-value">
            {totals.bestDay && totals.bestDay.count > 0 ? (
              <>
                {metric === 'count'
                  ? totals.bestDay.count
                  : totals.bestDay.score.toFixed(1)}
                <small> · {formatBR(totals.bestDay.date)}</small>
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
        <p className="muted">
          Nenhuma tarefa concluída neste projeto.
        </p>
      ) : (
        <>
          <div className="stats-section">
            <h3 className="stats-section-title">Atividade</h3>
            <Heatmap buckets={buckets} metric={metric} />
          </div>

          <div className="stats-section">
            <h3 className="stats-section-title">
              {metric === 'count' ? 'Tarefas por dia' : 'Score por dia'}
            </h3>
            <DailyBars buckets={buckets} metric={metric} />
            <MoscowLegend />
          </div>
        </>
      )}
    </section>
  );
}
