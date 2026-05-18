import { useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../components/ProjectCard';
import type { ProjectFiltersState } from '../components/ProjectFiltersBar';
import { createProject, subscribeToProjects } from '../repositories/projectsRepo';
import { subscribeToTasks } from '../repositories/tasksRepo';
import type { Project, Task } from '../types';

export function ProjectsView({
  uid,
  filters,
}: {
  uid: string;
  filters: ProjectFiltersState;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onErr = (e: Error) => setError(e.message);
    const unsubProjects = subscribeToProjects(uid, setProjects, onErr);
    const unsubTasks = subscribeToTasks(uid, setTasks, onErr);
    return () => {
      unsubProjects();
      unsubTasks();
    };
  }, [uid]);

  const taskCountByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.section] = (counts[t.section] ?? 0) + 1;
    return counts;
  }, [tasks]);

  const filtered = useMemo(
    () => projects.filter((p) => filters.statusFilter.has(p.status)),
    [projects, filters],
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

  return (
    <section className="projects-view">
      {filtered.length === 0 && (
        <p className="muted">
          {projects.length === 0
            ? 'Nenhum projeto. Crie o primeiro abaixo.'
            : 'Nenhum projeto para o filtro selecionado.'}
        </p>
      )}

      <div className="project-list">
        {filtered.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            taskCount={taskCountByProject[p.id] ?? 0}
          />
        ))}
      </div>

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
