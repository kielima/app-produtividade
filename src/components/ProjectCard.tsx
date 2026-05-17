import { useProjectNavigation } from '../lib/projectNavigation';
import type { Project, ProjectStatus } from '../types';

const STATUS_SLUG: Record<ProjectStatus, string> = {
  'A iniciar': 'a-iniciar',
  'Em planejamento': 'em-planejamento',
  'Em andamento': 'em-andamento',
  Pausado: 'pausado',
  'Concluído': 'concluido',
  Cancelado: 'cancelado',
};

export function ProjectCard({
  project,
  taskCount,
}: {
  project: Project;
  taskCount: number;
}) {
  const { openProject, openProjectTasks } = useProjectNavigation();
  const isDone = project.status === 'Concluído' || project.status === 'Cancelado';
  const countLabel = `${taskCount} tarefa${taskCount === 1 ? '' : 's'}`;
  const statusClass = STATUS_SLUG[project.status];

  return (
    <article
      className={`project-card status-${statusClass}${isDone ? ' done' : ''}`}
    >
      <div className="project-line">
        <button
          type="button"
          className="project-title project-title-btn"
          onClick={() => openProject(project.id)}
          aria-label="abrir projeto"
        >
          {project.name}
        </button>
        <button
          type="button"
          className="muted project-task-count project-task-count-btn"
          onClick={() => openProjectTasks(project.id)}
          aria-label={`ver ${countLabel} do projeto ${project.name}`}
        >
          {countLabel}
        </button>
      </div>
    </article>
  );
}
