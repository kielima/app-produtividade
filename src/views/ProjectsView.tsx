import { useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../components/ProjectCard';
import type { ProjectFiltersState } from '../components/ProjectFiltersBar';
import { computeVolatilityBands } from '../lib/glicko2';
import { computeProgressByProject, filterAndSortProjects } from '../lib/projectFilterSort';
import { buildTaskCountByProject } from '../lib/taskHierarchy';
import { subscribeToGlickoRatings, type GlickoMap } from '../repositories/glickoRepo';
import type { UserData } from '../lib/useUserData';
import { createProject } from '../repositories/projectsRepo';
import type { Project } from '../types';
import { ProjectMoscowMatrix } from './ProjectMoscowMatrix';

const COLLAPSED_CATEGORIES_KEY = 'projectsCollapsedCategories';

function loadCollapsedCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_CATEGORIES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function ProjectsView({
  uid,
  data,
  filters,
  searchQuery = '',
}: {
  uid: string;
  // Tarefas e projetos vêm do `useUserData` do App, já em memória — antes
  // esta view assinava as duas tabelas de novo e baixava tudo a cada abertura.
  data: UserData;
  filters: ProjectFiltersState;
  searchQuery?: string;
}) {
  const { projects, tasks, loading } = data;
  const [glickoMap, setGlickoMap] = useState<GlickoMap>({});
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  // Categorias recolhidas na visualização "Por categoria". A chave é a mesma
  // usada no agrupamento ('' = "(sem categoria)"). Persistido em localStorage
  // para sobreviver à navegação (abrir um projeto e voltar) e a recargas.
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    loadCollapsedCategories,
  );

  useEffect(() => {
    localStorage.setItem(
      COLLAPSED_CATEGORIES_KEY,
      JSON.stringify([...collapsedCategories]),
    );
  }, [collapsedCategories]);

  function toggleCategory(key: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    return subscribeToGlickoRatings(uid, setGlickoMap, (e) => setError(e.message));
  }, [uid]);

  const taskCountByProject = useMemo(() => buildTaskCountByProject(tasks), [tasks]);

  const progressByProject = useMemo(
    () => computeProgressByProject(projects, taskCountByProject),
    [projects, taskCountByProject],
  );

  const filtered = useMemo(
    () => filterAndSortProjects(projects, filters, searchQuery, progressByProject),
    [projects, filters, progressByProject, searchQuery],
  );

  // Agrupamento por categoria para a visualização "Por categoria". Um projeto
  // com várias categorias aparece em cada grupo correspondente; sem categorias
  // entra no grupo "" ("(sem categoria)").
  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const p of filtered) {
      const keys = p.categories.length > 0 ? p.categories : [''];
      for (const key of keys) {
        const arr = groups.get(key);
        if (arr) arr.push(p);
        else groups.set(key, [p]);
      }
    }
    // Ordena categorias alfabeticamente; "(sem categoria)" sempre por último.
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === '') return 1;
      if (b[0] === '') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  // Bandas de volatilidade adaptativas: derivadas da população atual de σ,
  // se reajustam conforme os ratings mudam (ver `computeVolatilityBands`).
  const volatilityBands = useMemo(
    () => computeVolatilityBands(Object.values(glickoMap).map((g) => g.sigma)),
    [glickoMap],
  );

  async function handleAdd() {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      setNewName('');
      return;
    }
    await createProject(uid, name, projects.length);
    setNewName('');
    setAdding(false);
  }

  if (error) return <p className="error">Erro: {error}</p>;
  if (data.error) return <p className="error">Erro: {data.error.message}</p>;

  return (
    <section className="projects-view">
      {loading && <p className="muted">Carregando…</p>}
      {!loading && filtered.length === 0 && (
        <p className="muted">
          {projects.length === 0
            ? 'Nenhum projeto. Crie o primeiro abaixo.'
            : 'Nenhum projeto para o filtro selecionado.'}
        </p>
      )}

      {filters.viewMode === 'matrix' ? (
        <ProjectMoscowMatrix
          uid={uid}
          projects={filtered}
          taskCountByProject={taskCountByProject}
          glickoMap={glickoMap}
          volatilityBands={volatilityBands}
        />
      ) : filters.viewMode === 'category' ? (
        groupedByCategory.map(([category, group]) => {
          const collapsed = collapsedCategories.has(category);
          const label = category || '(sem categoria)';
          return (
            <div key={category || '__none__'} className="project-category-group">
              <h3 className="project-category-heading">
                <button
                  type="button"
                  className="project-category-toggle"
                  onClick={() => toggleCategory(category)}
                  aria-expanded={!collapsed}
                  aria-label={`${collapsed ? 'expandir' : 'recolher'} categoria ${label}`}
                >
                  <svg
                    className={`project-category-chevron${collapsed ? ' collapsed' : ''}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <span className="project-category-name">{label}</span>
                  <span className="muted project-category-count">{group.length}</span>
                </button>
              </h3>
              {!collapsed && (
                <div className="project-list">
                  {group.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      taskCount={taskCountByProject[p.id]?.total ?? 0}
                      doneTaskCount={taskCountByProject[p.id]?.done ?? 0}
                      glickoRating={glickoMap[p.id]}
                      volatilityBands={volatilityBands}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })
      ) : (
        <div className="project-list">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              taskCount={taskCountByProject[p.id]?.total ?? 0}
              doneTaskCount={taskCountByProject[p.id]?.done ?? 0}
              glickoRating={glickoMap[p.id]}
              volatilityBands={volatilityBands}
            />
          ))}
        </div>
      )}

      {adding ? (
        <div className="add-section-row">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleAdd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') {
                setNewName('');
                setAdding(false);
              }
            }}
            placeholder="Nome do novo projeto…"
            autoFocus
            className="inline-edit-input"
          />
        </div>
      ) : (
        <button
          type="button"
          className="fab"
          onClick={() => setAdding(true)}
          aria-label="adicionar projeto"
          title="adicionar projeto"
        >
          +
        </button>
      )}
    </section>
  );
}
