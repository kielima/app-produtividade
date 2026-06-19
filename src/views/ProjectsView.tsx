import { useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../components/ProjectCard';
import type { ProjectFiltersState } from '../components/ProjectFiltersBar';
import { subscribeToGlickoRatings, type GlickoMap } from '../repositories/glickoRepo';
import { createProject, subscribeToProjects } from '../repositories/projectsRepo';
import { subscribeToTasks } from '../repositories/tasksRepo';
import type { Project, Task } from '../types';

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
  filters,
}: {
  uid: string;
  filters: ProjectFiltersState;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
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
    const onErr = (e: Error) => setError(e.message);
    const unsubProjects = subscribeToProjects(uid, setProjects, onErr);
    const unsubTasks = subscribeToTasks(uid, setTasks, onErr);
    const unsubGlicko = subscribeToGlickoRatings(uid, setGlickoMap, onErr);
    return () => {
      unsubProjects();
      unsubTasks();
      unsubGlicko();
    };
  }, [uid]);

  const taskCountByProject = useMemo(() => {
    const counts: Record<string, { total: number; done: number }> = {};
    for (const t of tasks) {
      const entry = counts[t.section] ?? { total: 0, done: 0 };
      entry.total += 1;
      if (t.checked) entry.done += 1;
      counts[t.section] = entry;
    }
    return counts;
  }, [tasks]);

  // Progresso (0..1) por projeto: fração de tarefas concluídas. Projetos sem
  // tarefas ficam como null (sem progresso definido).
  const progressByProject = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const p of projects) {
      const c = taskCountByProject[p.id];
      out[p.id] = c && c.total > 0 ? c.done / c.total : null;
    }
    return out;
  }, [projects, taskCountByProject]);

  const filtered = useMemo(() => {
    const list = projects.filter((p) => filters.statusFilter.has(p.status));
    if (filters.sortMode === 'progress') {
      // Maior conclusão primeiro. Projetos sem tarefas (null) vão para o fim,
      // preservando entre empates a ordem manual (por nota) original.
      return list
        .map((p, idx) => ({ p, idx }))
        .sort((a, b) => {
          const pa = progressByProject[a.p.id];
          const pb = progressByProject[b.p.id];
          const va = pa ?? -1;
          const vb = pb ?? -1;
          if (vb !== va) return vb - va;
          return a.idx - b.idx;
        })
        .map((x) => x.p);
    }
    // 'score': mantém a ordem manual (maior nota primeiro), já vinda do repo.
    return list;
  }, [projects, filters, progressByProject]);

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

  return (
    <section className="projects-view">
      {filtered.length === 0 && (
        <p className="muted">
          {projects.length === 0
            ? 'Nenhum projeto. Crie o primeiro abaixo.'
            : 'Nenhum projeto para o filtro selecionado.'}
        </p>
      )}

      {filters.viewMode === 'category' ? (
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
