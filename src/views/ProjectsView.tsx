import { useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../components/ProjectCard';
import { createProject, subscribeToProjects } from '../repositories/projectsRepo';
import { subscribeToTasks } from '../repositories/tasksRepo';
import type { Project, ProjectStatus, Task } from '../types';

type StatusFilter = ProjectStatus | 'all';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'A iniciar', label: 'A iniciar' },
  { value: 'Em andamento', label: 'Em andamento' },
  { value: 'Pausado', label: 'Pausado' },
  { value: 'Concluído', label: 'Concluído' },
  { value: 'Cancelado', label: 'Cancelado' },
];

export function ProjectsView({ uid }: { uid: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
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
    () =>
      statusFilter === 'all'
        ? projects
        : projects.filter((p) => p.status === statusFilter),
    [projects, statusFilter],
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
      <header className="filters">
        <label>
          Status:&nbsp;
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <span className="counter">
          {filtered.length} de {projects.length}
        </span>
      </header>

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
            uid={uid}
            project={p}
            taskCount={taskCountByProject[p.id] ?? 0}
          />
        ))}
      </div>

      <div className="add-section-row">
        {adding ? (
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
        ) : (
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            + adicionar projeto
          </button>
        )}
      </div>
    </section>
  );
}
