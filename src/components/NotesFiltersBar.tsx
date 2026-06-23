import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { ProjectCombobox } from './TaskFiltersBar';

export const NO_TAG_FILTER = '__sem_tag__';

export function NotesFiltersBar({
  allTags,
  selectedTags,
  setSelectedTags,
  searchQuery,
  onClearSearch,
  projects = [],
  projectFilter,
  setProjectFilter,
}: {
  allTags: string[];
  selectedTags: string[];
  setSelectedTags: (next: string[]) => void;
  searchQuery?: string;
  onClearSearch?: () => void;
  projects?: Project[];
  projectFilter?: string | null;
  setProjectFilter?: (id: string | null) => void;
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

  function toggleTag(tag: string) {
    setSelectedTags(
      selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag],
    );
  }

  function clearFilters() {
    setSelectedTags([]);
    setProjectFilter?.(null);
    onClearSearch?.();
    setOpen(false);
  }

  const activeProjects = projects.filter(
    (p) => p.status !== 'Concluído' && p.status !== 'Cancelado',
  );
  const inactiveProjects = projects.filter(
    (p) => p.status === 'Concluído' || p.status === 'Cancelado',
  );
  const allSortedProjects = [...activeProjects, ...inactiveProjects];

  const count = selectedTags.length + (projectFilter ? 1 : 0);
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

          {setProjectFilter && allSortedProjects.length > 0 && (
            <fieldset>
              <legend>Projeto</legend>
              <ProjectCombobox
                value={projectFilter ?? ''}
                onChange={(next) => setProjectFilter(next || null)}
                projects={allSortedProjects}
              />
            </fieldset>
          )}

          <fieldset>
            <legend>Tags</legend>
            {allTags.length === 0 ? (
              <p className="muted">Nenhuma tag ainda.</p>
            ) : (
              <div className="chip-group">
                {(() => {
                  const noTagActive = selectedTags.includes(NO_TAG_FILTER);
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
                  const active = selectedTags.includes(tag);
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
