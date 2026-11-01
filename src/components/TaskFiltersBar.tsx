import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeForSearch } from '../lib/searchNormalize';
import { NO_TAG_FILTER } from '../lib/tags';
import { ResourceAvatar } from './ResourceAvatar';
import { useResources } from '../lib/resources';
import type { Esforco, MoSCoW, Project } from '../types';

export { NO_TAG_FILTER };

// Valor especial do filtro de responsável: tarefas sem ninguém atribuído.
export const NO_RESPONSAVEL_FILTER = '__sem_responsavel__';

const MOSCOW_LABEL: Record<MoSCoW, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
  '': 'Sem MoSCoW',
};

export const MOSCOW_VALUES: MoSCoW[] = [
  'must',
  'should',
  'could',
  'wont',
  '',
];

const ESFORCO_LABEL: Record<Esforco, string> = {
  rapido: 'Rápido',
  medio: 'Médio',
  longo: 'Longo',
  '': 'Sem esforço',
};

export const ESFORCO_VALUES: Esforco[] = ['rapido', 'medio', 'longo', ''];

export type StatusKey = 'todo' | 'doing' | 'done';

const STATUS_LABEL: Record<StatusKey, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluída',
};

export const STATUS_VALUES: StatusKey[] = ['todo', 'doing', 'done'];

export type TaskViewMode = 'list' | 'matrix' | 'gantt';

export const TASK_VIEW_LABEL: Record<TaskViewMode, string> = {
  list: 'Lista',
  matrix: 'Matriz MoSCoW',
  gantt: 'Gantt',
};

export interface TaskFiltersState {
  hideZero: boolean;
  hideCompleted: boolean;
  hideSnoozed: boolean;
  onlyWithoutDeadline: boolean;
  // Só tarefas (e notas) cujo último comentário é do Claude — ver
  // src/lib/aguardaResposta.ts. Igual ao filtro do painel da Sudeste.
  onlyAwaitingReply: boolean;
  projectFilter: string;
  // Ids de recursos aceitos (ou NO_RESPONSAVEL_FILTER). Vazio = todos.
  responsavelFilter: string[];
  moscowFilter: Set<MoSCoW>;
  esforcoFilter: Set<Esforco>;
  statusFilter: Set<StatusKey>;
  viewMode: TaskViewMode;
  tagFilter: string[];
}

export function defaultFiltersState(): TaskFiltersState {
  return {
    hideZero: true,
    hideCompleted: true,
    hideSnoozed: true,
    onlyWithoutDeadline: false,
    onlyAwaitingReply: false,
    projectFilter: '',
    responsavelFilter: [],
    moscowFilter: new Set<MoSCoW>(MOSCOW_VALUES),
    esforcoFilter: new Set<Esforco>(ESFORCO_VALUES),
    statusFilter: new Set<StatusKey>(STATUS_VALUES),
    viewMode: 'list',
    tagFilter: [],
  };
}

interface SerializedTaskFilters {
  hideZero: boolean;
  hideCompleted: boolean;
  hideSnoozed: boolean;
  onlyWithoutDeadline: boolean;
  onlyAwaitingReply?: boolean;
  projectFilter: string;
  responsavelFilter: string[];
  moscowFilter: MoSCoW[];
  esforcoFilter: Esforco[];
  statusFilter: StatusKey[];
  viewMode: TaskViewMode;
  tagFilter: string[];
}

export function serializeFiltersState(
  state: TaskFiltersState,
): SerializedTaskFilters {
  return {
    hideZero: state.hideZero,
    hideCompleted: state.hideCompleted,
    hideSnoozed: state.hideSnoozed,
    onlyWithoutDeadline: state.onlyWithoutDeadline,
    onlyAwaitingReply: state.onlyAwaitingReply,
    projectFilter: state.projectFilter,
    responsavelFilter: [...state.responsavelFilter],
    moscowFilter: [...state.moscowFilter],
    esforcoFilter: [...state.esforcoFilter],
    statusFilter: [...state.statusFilter],
    viewMode: state.viewMode,
    tagFilter: [...state.tagFilter],
  };
}

export function deserializeFiltersState(raw: unknown): TaskFiltersState {
  const base = defaultFiltersState();
  if (!raw || typeof raw !== 'object') return base;
  const v = raw as Partial<SerializedTaskFilters>;
  function allowed<T>(arr: unknown, valid: readonly T[]): Set<T> {
    if (!Array.isArray(arr)) return new Set(valid);
    const filtered = arr.filter((x): x is T =>
      (valid as readonly unknown[]).includes(x),
    );
    return new Set(filtered);
  }
  return {
    hideZero: typeof v.hideZero === 'boolean' ? v.hideZero : base.hideZero,
    hideCompleted:
      typeof v.hideCompleted === 'boolean' ? v.hideCompleted : base.hideCompleted,
    hideSnoozed:
      typeof v.hideSnoozed === 'boolean' ? v.hideSnoozed : base.hideSnoozed,
    onlyWithoutDeadline:
      typeof v.onlyWithoutDeadline === 'boolean'
        ? v.onlyWithoutDeadline
        : base.onlyWithoutDeadline,
    onlyAwaitingReply:
      typeof v.onlyAwaitingReply === 'boolean' ? v.onlyAwaitingReply : base.onlyAwaitingReply,
    projectFilter:
      typeof v.projectFilter === 'string' ? v.projectFilter : base.projectFilter,
    responsavelFilter: Array.isArray(v.responsavelFilter)
      ? v.responsavelFilter.filter((t): t is string => typeof t === 'string')
      : base.responsavelFilter,
    moscowFilter: allowed(v.moscowFilter, MOSCOW_VALUES),
    esforcoFilter: allowed(v.esforcoFilter, ESFORCO_VALUES),
    statusFilter: allowed(v.statusFilter, STATUS_VALUES),
    viewMode:
      v.viewMode === 'matrix' || v.viewMode === 'gantt' ? v.viewMode : base.viewMode,
    tagFilter: Array.isArray(v.tagFilter)
      ? v.tagFilter.filter((t): t is string => typeof t === 'string')
      : base.tagFilter,
  };
}

export function activeFilterCount(
  state: TaskFiltersState,
  showHideZero: boolean,
): number {
  return (
    (showHideZero && !state.hideZero ? 1 : 0) +
    (state.hideCompleted ? 0 : 1) +
    (state.hideSnoozed ? 0 : 1) +
    (state.onlyWithoutDeadline ? 1 : 0) +
    (state.onlyAwaitingReply ? 1 : 0) +
    (state.projectFilter ? 1 : 0) +
    (state.responsavelFilter.length > 0 ? 1 : 0) +
    (state.moscowFilter.size === MOSCOW_VALUES.length ? 0 : 1) +
    (state.esforcoFilter.size === ESFORCO_VALUES.length ? 0 : 1) +
    (state.statusFilter.size === STATUS_VALUES.length ? 0 : 1) +
    state.tagFilter.length
  );
}

export function TaskFiltersBar({
  state,
  setState,
  showHideZero,
  onOpenClassify,
  classifyCount,
  searchQuery,
  onClearSearch,
  allTags = [],
  awaitingCount,
}: {
  state: TaskFiltersState;
  setState: (next: TaskFiltersState) => void;
  showHideZero: boolean;
  onOpenClassify?: () => void;
  classifyCount?: number;
  searchQuery?: string;
  onClearSearch?: () => void;
  allTags?: string[];
  // Quantas tarefas/notas esperam resposta agora — mostrado ao lado da opção.
  awaitingCount?: { tarefas: number; projetos: number; notas: number };
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

  const { resources } = useResources();

  function toggleResponsavel(id: string) {
    setState({
      ...state,
      responsavelFilter: state.responsavelFilter.includes(id)
        ? state.responsavelFilter.filter((r) => r !== id)
        : [...state.responsavelFilter, id],
    });
  }

  function toggleMoscow(m: MoSCoW) {
    const next = new Set(state.moscowFilter);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    setState({ ...state, moscowFilter: next });
  }

  function toggleEsforco(e: Esforco) {
    const next = new Set(state.esforcoFilter);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    setState({ ...state, esforcoFilter: next });
  }

  function toggleStatus(s: StatusKey) {
    const next = new Set(state.statusFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setState({ ...state, statusFilter: next });
  }

  function toggleTag(tag: string) {
    setState({
      ...state,
      tagFilter: state.tagFilter.includes(tag)
        ? state.tagFilter.filter((t) => t !== tag)
        : [...state.tagFilter, tag],
    });
  }

  function clearFilters() {
    setState(defaultFiltersState());
    onClearSearch?.();
    setOpen(false);
  }

  const count = activeFilterCount(state, showHideZero);
  const hasSearch = !!searchQuery;

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
          {onOpenClassify && (
            <button
              type="button"
              className="classify-cta"
              onClick={() => {
                setOpen(false);
                onOpenClassify();
              }}
              disabled={!classifyCount}
            >
              <span className="classify-cta-label">Classificar tarefas</span>
              <span className="classify-cta-sub">
                {classifyCount
                  ? `${classifyCount} sem MoSCoW ou esforço`
                  : 'Tudo classificado'}
              </span>
            </button>
          )}

          <fieldset>
            <legend>Mostrar só</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={state.onlyAwaitingReply}
                onChange={(e) => setState({ ...state, onlyAwaitingReply: e.target.checked })}
              />
              &nbsp;💬 esperando minha resposta
              {awaitingCount && (
                <span className="muted">
                  &nbsp;({awaitingCount.tarefas} {awaitingCount.tarefas === 1 ? 'tarefa' : 'tarefas'},{' '}
                  {awaitingCount.projetos} {awaitingCount.projetos === 1 ? 'projeto' : 'projetos'},{' '}
                  {awaitingCount.notas} {awaitingCount.notas === 1 ? 'nota' : 'notas'})
                </span>
              )}
            </label>
          </fieldset>

          <fieldset>
            <legend>Ocultar</legend>
            {showHideZero && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={state.hideZero}
                  onChange={(e) =>
                    setState({ ...state, hideZero: e.target.checked })
                  }
                />
                &nbsp;score 0
              </label>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={state.hideCompleted}
                onChange={(e) =>
                  setState({ ...state, hideCompleted: e.target.checked })
                }
              />
              &nbsp;concluídas
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={state.hideSnoozed}
                onChange={(e) =>
                  setState({ ...state, hideSnoozed: e.target.checked })
                }
              />
              &nbsp;adiadas
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={state.onlyWithoutDeadline}
                onChange={(e) =>
                  setState({
                    ...state,
                    onlyWithoutDeadline: e.target.checked,
                  })
                }
              />
              &nbsp;sem data
            </label>
          </fieldset>

          <fieldset>
            <legend>Visualização</legend>
            <div className="chip-group">
              {(Object.keys(TASK_VIEW_LABEL) as TaskViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip${state.viewMode === m ? ' active' : ''}`}
                  onClick={() => setState({ ...state, viewMode: m })}
                  aria-pressed={state.viewMode === m}
                >
                  {TASK_VIEW_LABEL[m]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Responsável</legend>
            <div className="chip-group">
              {resources.map((r) => {
                const active = state.responsavelFilter.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`chip chip-responsavel${active ? ' active' : ''}`}
                    onClick={() => toggleResponsavel(r.id)}
                    aria-pressed={active}
                  >
                    <ResourceAvatar resource={r} size={16} />
                    {r.nome}
                  </button>
                );
              })}
              <button
                type="button"
                className={`chip${state.responsavelFilter.includes(NO_RESPONSAVEL_FILTER) ? ' active' : ''}`}
                onClick={() => toggleResponsavel(NO_RESPONSAVEL_FILTER)}
                aria-pressed={state.responsavelFilter.includes(NO_RESPONSAVEL_FILTER)}
              >
                Sem responsável
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>MoSCoW</legend>
            <div className="chip-group">
              {MOSCOW_VALUES.map((m) => (
                <button
                  key={m || 'empty'}
                  type="button"
                  className={`chip${state.moscowFilter.has(m) ? ' active' : ''}`}
                  onClick={() => toggleMoscow(m)}
                  aria-pressed={state.moscowFilter.has(m)}
                >
                  {MOSCOW_LABEL[m]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Esforço</legend>
            <div className="chip-group">
              {ESFORCO_VALUES.map((e) => (
                <button
                  key={e || 'empty'}
                  type="button"
                  className={`chip${state.esforcoFilter.has(e) ? ' active' : ''}`}
                  onClick={() => toggleEsforco(e)}
                  aria-pressed={state.esforcoFilter.has(e)}
                >
                  {ESFORCO_LABEL[e]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Kanban</legend>
            <div className="chip-group">
              {STATUS_VALUES.map((s) => (
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

          <fieldset>
            <legend>Tags</legend>
            {allTags.length === 0 ? (
              <p className="muted">Nenhuma tag ainda.</p>
            ) : (
              <div className="chip-group">
                {(() => {
                  const noTagActive = state.tagFilter.includes(NO_TAG_FILTER);
                  return (
                    <button
                      type="button"
                      className={`tag-chip tag-chip-toggle${noTagActive ? ' active' : ''}`}
                      onClick={() => toggleTag(NO_TAG_FILTER)}
                      aria-pressed={noTagActive}
                    >
                      sem tag
                    </button>
                  );
                })()}
                {allTags.map((tag) => {
                  const active = state.tagFilter.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-chip tag-chip-toggle${active ? ' active' : ''}`}
                      onClick={() => toggleTag(tag)}
                      aria-pressed={active}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <button
            type="button"
            className="btn-link"
            onClick={clearFilters}
            disabled={count === 0 && !hasSearch}
          >
            limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}

type ComboOption =
  | { kind: 'select'; id: string; name: string }
  | { kind: 'create'; name: string };

export function ProjectCombobox({
  value,
  onChange,
  projects,
  onCreateProject,
}: {
  value: string;
  onChange: (next: string) => void;
  projects: Project[];
  onCreateProject?: (name: string) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selectedName = useMemo(() => {
    if (!value) return '';
    return projects.find((p) => p.id === value)?.name ?? '';
  }, [value, projects]);

  const options = useMemo<ComboOption[]>(() => {
    const q = normalizeForSearch(query.trim());
    const todos: ComboOption = { kind: 'select', id: '', name: 'Todos' };
    const matched: ComboOption[] = projects
      .filter((p) => (q ? normalizeForSearch(p.name).includes(q) : true))
      .map((p) => ({ kind: 'select' as const, id: p.id, name: p.name }));
    const list: ComboOption[] = !q || 'todos'.includes(q) ? [todos, ...matched] : matched;
    const trimmed = query.trim();
    const hasExact =
      trimmed.length > 0 &&
      projects.some((p) => normalizeForSearch(p.name) === q);
    if (onCreateProject && trimmed.length > 0 && !hasExact) {
      list.push({ kind: 'create', name: trimmed });
    }
    return list;
  }, [projects, query, onCreateProject]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  function selectOption(id: string) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  async function createAndSelect(name: string) {
    if (!onCreateProject || creating) return;
    try {
      setCreating(true);
      const newId = await onCreateProject(name);
      onChange(newId);
      setOpen(false);
      setQuery('');
    } finally {
      setCreating(false);
    }
  }

  function pickOption(opt: ComboOption) {
    if (opt.kind === 'create') void createAndSelect(opt.name);
    else selectOption(opt.id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIdx((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && options[activeIdx]) {
        e.preventDefault();
        pickOption(options[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Tab') {
      if (open) {
        setOpen(false);
        setQuery('');
      }
    }
  }

  const displayValue = open ? query : selectedName;

  return (
    <div className="combobox" ref={wrapRef}>
      <input
        type="text"
        className="filter-select combobox-input"
        role="combobox"
        aria-expanded={open}
        aria-controls="project-combobox-list"
        aria-autocomplete="list"
        value={displayValue}
        placeholder="Todos"
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {value && !open && (
        <button
          type="button"
          className="combobox-clear"
          onMouseDown={(e) => {
            e.preventDefault();
            onChange('');
            setQuery('');
          }}
          aria-label="limpar projeto"
        >
          ×
        </button>
      )}
      {open && (
        <ul
          id="project-combobox-list"
          role="listbox"
          className="combobox-list"
          ref={listRef}
        >
          {options.length === 0 && (
            <li className="combobox-empty muted">Nada encontrado.</li>
          )}
          {options.map((opt, i) => {
            const isCreate = opt.kind === 'create';
            const isSelected = !isCreate && value === opt.id;
            const key = isCreate ? `__create__:${opt.name}` : opt.id || '__all__';
            return (
              <li
                key={key}
                role="option"
                data-idx={i}
                aria-selected={isSelected}
                className={`combobox-option${i === activeIdx ? ' active' : ''}${
                  isSelected ? ' selected' : ''
                }${isCreate ? ' combobox-option-create' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickOption(opt);
                }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                {isCreate ? (
                  <>
                    <span className="combobox-create-icon" aria-hidden="true">
                      +
                    </span>
                    Criar projeto “{opt.name}”
                  </>
                ) : (
                  opt.name
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
