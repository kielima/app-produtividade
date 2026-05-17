import { useProjectNavigation } from '../lib/projectNavigation';
import type { Project } from '../types';

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

  return (
    <article className={`project-card${isDone ? ' done' : ''}`}>
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
