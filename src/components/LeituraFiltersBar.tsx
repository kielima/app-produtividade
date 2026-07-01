import { useEffect, useRef, useState } from 'react';
import type { ReadingItemType, ReadingStatus } from '../types';

export interface ReadingFiltersState {
  search: string;
  author: string; // '' = todos
  tag: string; // '' = todas
  itemType: ReadingItemType | 'all';
  status: ReadingStatus | 'all';
}

export function defaultReadingFiltersState(): ReadingFiltersState {
  return { search: '', author: '', tag: '', itemType: 'all', status: 'all' };
}

const READING_FILTERS_KEY = 'app-produtividade:reading-filters';

export function loadReadingFilters(): ReadingFiltersState {
  try {
    const raw = localStorage.getItem(READING_FILTERS_KEY);
    if (!raw) return defaultReadingFiltersState();
    const parsed = JSON.parse(raw) as Partial<ReadingFiltersState>;
    return { ...defaultReadingFiltersState(), ...parsed };
  } catch {
    return defaultReadingFiltersState();
  }
}

export function saveReadingFilters(state: ReadingFiltersState): void {
  try {
    localStorage.setItem(READING_FILTERS_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function activeReadingFilterCount(state: ReadingFiltersState): number {
  return (
    (state.author ? 1 : 0) +
    (state.tag ? 1 : 0) +
    (state.itemType !== 'all' ? 1 : 0) +
    (state.status !== 'all' ? 1 : 0)
  );
}

export function LeituraFiltersBar({
  state,
  setState,
  allAuthors,
  allTags,
}: {
  state: ReadingFiltersState;
  setState: (s: ReadingFiltersState) => void;
  allAuthors: string[];
  allTags: string[];
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
    setState({ ...state, author: '', tag: '', itemType: 'all', status: 'all' });
    setOpen(false);
  }

  const count = activeReadingFilterCount(state);

  return (
    <div className="reading-filters">
      <input
        className="reading-search"
        type="search"
        placeholder="Pesquisar título, autor, DOI…"
        value={state.search}
        onChange={(e) => setState({ ...state, search: e.target.value })}
      />
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
              <legend>Autor</legend>
              <select
                className="filter-select"
                value={state.author}
                onChange={(e) => setState({ ...state, author: e.target.value })}
                aria-label="Filtrar por autor"
              >
                <option value="">Todos os autores</option>
                {allAuthors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset>
              <legend>Tag</legend>
              <select
                className="filter-select"
                value={state.tag}
                onChange={(e) => setState({ ...state, tag: e.target.value })}
                aria-label="Filtrar por tag"
              >
                <option value="">Todas as tags</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset>
              <legend>Tipo</legend>
              <select
                className="filter-select"
                value={state.itemType}
                onChange={(e) =>
                  setState({
                    ...state,
                    itemType: e.target.value as ReadingFiltersState['itemType'],
                  })
                }
                aria-label="Filtrar por tipo"
              >
                <option value="all">Todos os tipos</option>
                <option value="article">Artigos</option>
                <option value="book">Livros</option>
                <option value="other">Outros</option>
              </select>
            </fieldset>

            <fieldset>
              <legend>Status</legend>
              <select
                className="filter-select"
                value={state.status}
                onChange={(e) =>
                  setState({
                    ...state,
                    status: e.target.value as ReadingFiltersState['status'],
                  })
                }
                aria-label="Filtrar por status"
              >
                <option value="all">Todos os status</option>
                <option value="to-read">A ler</option>
                <option value="reading">Lendo</option>
                <option value="read">Lido</option>
              </select>
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
    </div>
  );
}
