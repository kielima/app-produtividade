import { useEffect, useRef, useState } from 'react';
import type { ProjectStatus } from '../types';

export type ProjectStatusKey = Exclude<ProjectStatus, ''>;

const STATUS_LABEL: Record<ProjectStatusKey, string> = {
  'A iniciar': 'A iniciar',
  'Em planejamento': 'Em planejamento',
  'Em andamento': 'Em andamento',
  Pausado: 'Pausado',
  Concluído: 'Concluído',
  Cancelado: 'Cancelado',
};

export const PROJECT_STATUS_VALUES: ProjectStatusKey[] = [
  'A iniciar',
  'Em planejamento',
  'Em andamento',
  'Pausado',
  'Concluído',
  'Cancelado',
];

export interface ProjectFiltersState {
  statusFilter: Set<ProjectStatusKey>;
}

export function defaultProjectFiltersState(): ProjectFiltersState {
  return {
    statusFilter: new Set<ProjectStatusKey>(PROJECT_STATUS_VALUES),
  };
}

interface SerializedProjectFilters {
  statusFilter: ProjectStatusKey[];
}

export function serializeProjectFiltersState(
  state: ProjectFiltersState,
): SerializedProjectFilters {
  return { statusFilter: [...state.statusFilter] };
}

export function deserializeProjectFiltersState(
  raw: unknown,
): ProjectFiltersState {
  const base = defaultProjectFiltersState();
  if (!raw || typeof raw !== 'object') return base;
  const v = raw as Partial<SerializedProjectFilters>;
  if (!Array.isArray(v.statusFilter)) return base;
  const filtered = v.statusFilter.filter((x): x is ProjectStatusKey =>
    (PROJECT_STATUS_VALUES as readonly string[]).includes(x as string),
  );
  return { statusFilter: new Set(filtered) };
}

export function activeProjectFilterCount(state: ProjectFiltersState): number {
  return state.statusFilter.size === PROJECT_STATUS_VALUES.length ? 0 : 1;
}

export function isAllProjectStatuses(state: ProjectFiltersState): boolean {
  return state.statusFilter.size === PROJECT_STATUS_VALUES.length;
}

export function ProjectFiltersBar({
  state,
  setState,
}: {
  state: ProjectFiltersState;
  setState: (next: ProjectFiltersState) => void;
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

  function toggleStatus(s: ProjectStatusKey) {
    const next = new Set(state.statusFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setState({ ...state, statusFilter: next });
  }

  function clearFilters() {
    setState(defaultProjectFiltersState());
  }

  const count = activeProjectFilterCount(state);

  return (
    <div className="topbar-filter" ref={wrapRef}>
      <button
        type="button"
        className="btn-secondary filters-toggle"
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
        {count > 0 ? <span className="filters-count">{count}</span> : null}
      </button>
      {open && (
        <div
          className="filters-panel filters-panel-pop"
          role="dialog"
          aria-label="filtros"
        >
          <fieldset>
            <legend>Status</legend>
            <div className="chip-group">
              {PROJECT_STATUS_VALUES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${state.statusFilter.has(s) ? ' active' : ''}`}
                  onClick={() => toggleStatus(s)}
                  aria-pressed={state.statusFilter.has(s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
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
