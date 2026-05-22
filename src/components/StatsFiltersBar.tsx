import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { ProjectCombobox } from './TaskFiltersBar';

export type StatsRangeKey = '7' | '30' | '90' | '365';
export type StatsMetric = 'count' | 'score';
export type StatsDimension = 'moscow' | 'esforco' | 'modo';

export const STATS_RANGE_VALUES: StatsRangeKey[] = ['7', '30', '90', '365'];
export const STATS_METRIC_VALUES: StatsMetric[] = ['count', 'score'];
export const STATS_DIMENSION_VALUES: StatsDimension[] = [
  'moscow',
  'esforco',
  'modo',
];

const RANGE_LABEL: Record<StatsRangeKey, string> = {
  '7': '7 dias',
  '30': '30 dias',
  '90': '90 dias',
  '365': '1 ano',
};

const METRIC_LABEL: Record<StatsMetric, string> = {
  count: 'Contagem',
  score: 'Score',
};

const DIMENSION_LABEL: Record<StatsDimension, string> = {
  moscow: 'MoSCoW',
  esforco: 'Esforço',
  modo: 'Modo',
};

export interface StatsFiltersState {
  range: StatsRangeKey;
  metric: StatsMetric;
  dimension: StatsDimension;
  projectFilter: string;
}

export function defaultStatsFiltersState(): StatsFiltersState {
  return {
    range: '90',
    metric: 'count',
    dimension: 'moscow',
    projectFilter: '',
  };
}

export function serializeStatsFiltersState(
  state: StatsFiltersState,
): StatsFiltersState {
  return { ...state };
}

export function deserializeStatsFiltersState(raw: unknown): StatsFiltersState {
  const base = defaultStatsFiltersState();
  if (!raw || typeof raw !== 'object') return base;
  const v = raw as Partial<StatsFiltersState>;
  return {
    range: STATS_RANGE_VALUES.includes(v.range as StatsRangeKey)
      ? (v.range as StatsRangeKey)
      : base.range,
    metric: STATS_METRIC_VALUES.includes(v.metric as StatsMetric)
      ? (v.metric as StatsMetric)
      : base.metric,
    dimension: STATS_DIMENSION_VALUES.includes(v.dimension as StatsDimension)
      ? (v.dimension as StatsDimension)
      : base.dimension,
    projectFilter:
      typeof v.projectFilter === 'string' ? v.projectFilter : base.projectFilter,
  };
}

export function activeStatsFilterCount(state: StatsFiltersState): number {
  const base = defaultStatsFiltersState();
  return (
    (state.range === base.range ? 0 : 1) +
    (state.metric === base.metric ? 0 : 1) +
    (state.dimension === base.dimension ? 0 : 1) +
    (state.projectFilter ? 1 : 0)
  );
}

export function StatsFiltersBar({
  state,
  setState,
  projects,
}: {
  state: StatsFiltersState;
  setState: (next: StatsFiltersState) => void;
  projects: Project[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function clearFilters() {
    setState(defaultStatsFiltersState());
    setOpen(false);
  }

  const count = activeStatsFilterCount(state);

  return (
    <div className="topbar-filter" ref={wrapRef}>
      <button
        type="button"
        className={`btn-secondary filters-toggle${count > 0 ? ' filters-toggle--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Filtros${count > 0 ? ` (${count} ativos)` : ''}`}
        title={`Filtros${count > 0 ? ` (${count})` : ''}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 512 512"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="36"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M16 18h480L320 240v206l-128 48V240L16 18z" />
        </svg>
      </button>
      {open && (
        <div
          className="filters-panel filters-panel-pop"
          role="dialog"
          aria-modal="true"
          aria-label="filtros"
        >
          <div className="filters-panel-header">
            <h3 className="filters-panel-title">Filtros</h3>
            <button
              type="button"
              className="filters-panel-close"
              onClick={() => setOpen(false)}
              aria-label="fechar filtros"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <fieldset>
            <legend>Período</legend>
            <div
              className="stats-control-group"
              role="radiogroup"
              aria-label="Período"
            >
              {STATS_RANGE_VALUES.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={state.range === k}
                  className={`stats-chip ${state.range === k ? 'stats-chip--active' : ''}`}
                  onClick={() => setState({ ...state, range: k })}
                >
                  {RANGE_LABEL[k]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Métrica</legend>
            <div
              className="stats-control-group"
              role="radiogroup"
              aria-label="Métrica"
            >
              {STATS_METRIC_VALUES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={state.metric === m}
                  className={`stats-chip ${state.metric === m ? 'stats-chip--active' : ''}`}
                  onClick={() => setState({ ...state, metric: m })}
                >
                  {METRIC_LABEL[m]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Empilhar por</legend>
            <div
              className="stats-control-group"
              role="radiogroup"
              aria-label="Empilhar por"
            >
              {STATS_DIMENSION_VALUES.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={state.dimension === d}
                  className={`stats-chip ${state.dimension === d ? 'stats-chip--active' : ''}`}
                  onClick={() => setState({ ...state, dimension: d })}
                >
                  {DIMENSION_LABEL[d]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Projeto</legend>
            <div className="stats-project-filter">
              <ProjectCombobox
                value={state.projectFilter}
                onChange={(next) =>
                  setState({ ...state, projectFilter: next })
                }
                projects={projects}
              />
            </div>
          </fieldset>

          <button
            type="button"
            className="btn-link"
            onClick={clearFilters}
            disabled={count === 0}
          >
            limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}
