import { useEffect, useMemo, useRef, useState } from 'react';
import type { Modo, Project } from '../types';

const MODO_LABEL: Record<Modo, string> = {
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
  automatizar: 'Automatizar',
  '': '—',
};

export const MODO_VALUES: Modo[] = [
  'manual',
  'colaborar',
  'delegar',
  'automatizar',
  '',
];

export interface TaskFiltersState {
  hideZero: boolean;
  hideCompleted: boolean;
  projectFilter: string;
  modoFilter: Set<Modo>;
}

export function defaultFiltersState(): TaskFiltersState {
  return {
    hideZero: true,
    hideCompleted: true,
    projectFilter: '',
    modoFilter: new Set<Modo>(MODO_VALUES),
  };
}

export function activeFilterCount(
  state: TaskFiltersState,
  showHideZero: boolean,
): number {
  return (
    (showHideZero && !state.hideZero ? 1 : 0) +
    (state.hideCompleted ? 0 : 1) +
    (state.projectFilter ? 1 : 0) +
    (state.modoFilter.size === MODO_VALUES.length ? 0 : 1)
  );
}

export function TaskFiltersBar({
  state,
  setState,
  projects,
  showHideZero,
  onCreateProject,
}: {
  state: TaskFiltersState;
  setState: (next: TaskFiltersState) => void;
  projects: Project[];
  showHideZero: boolean;
  onCreateProject?: (name: string) => Promise<string>;
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

  function toggleModo(m: Modo) {
    const next = new Set(state.modoFilter);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    setState({ ...state, modoFilter: next });
  }

  function clearFilters() {
    setState(defaultFiltersState());
  }

  const count = activeFilterCount(state, showHideZero);

  return (
    <div className="topbar-filter" ref={wrapRef}>
      <button
        type="button"
        className="btn-secondary filters-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        🔽 Filtros{count > 0 ? ` (${count})` : ''}
      </button>
      {open && (
        <div
          className="filters-panel filters-panel-pop"
          role="dialog"
          aria-label="filtros"
        >
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
          </fieldset>

          <fieldset>
            <legend>Projeto</legend>
            <ProjectCombobox
              value={state.projectFilter}
              onChange={(next) =>
                setState({ ...state, projectFilter: next })
              }
              projects={projects}
              onCreateProject={onCreateProject}
            />
          </fieldset>

          <fieldset>
            <legend>Modo</legend>
            <div className="chip-group">
              {MODO_VALUES.map((m) => (
                <button
                  key={m || 'empty'}
                  type="button"
                  className={`chip${state.modoFilter.has(m) ? ' active' : ''}`}
                  onClick={() => toggleModo(m)}
                  aria-pressed={state.modoFilter.has(m)}
                >
                  {MODO_LABEL[m]}
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

type ComboOption =
  | { kind: 'select'; id: string; name: string }
  | { kind: 'create'; name: string };

function ProjectCombobox({
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
    const q = query.toLowerCase().trim();
    const todos: ComboOption = { kind: 'select', id: '', name: 'Todos' };
    const matched: ComboOption[] = projects
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .map((p) => ({ kind: 'select' as const, id: p.id, name: p.name }));
    const list: ComboOption[] = !q || 'todos'.includes(q) ? [todos, ...matched] : matched;
    const trimmed = query.trim();
    const hasExact =
      trimmed.length > 0 &&
      projects.some((p) => p.name.toLowerCase() === q);
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
      <span className="combobox-chevron" aria-hidden="true">
        ▾
      </span>
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
