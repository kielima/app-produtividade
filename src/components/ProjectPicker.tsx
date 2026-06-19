import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';

/**
 * Lista de projetos com campo de busca para filtrar por digitação.
 * Usada dentro do Popover do seletor de projeto da tarefa.
 */
export function ProjectPicker({
  projects,
  currentSection,
  onSelect,
}: {
  projects: Project[];
  currentSection: string;
  onSelect: (projectId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div className="project-picker">
      <input
        ref={inputRef}
        type="text"
        className="project-picker-search"
        placeholder="Filtrar projetos…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="project-picker-empty">Nenhum projeto encontrado</p>
      ) : (
        <ul className="picker-list">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={p.id === currentSection ? 'active' : ''}
                onClick={() => onSelect(p.id)}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
