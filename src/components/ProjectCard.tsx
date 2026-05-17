import { useProjectNavigation } from '../lib/projectNavigation';
import type { Project } from '../types';

export function ProjectCard({
  project,
  taskCount,
}: {
  project: Project;
  taskCount: number;
}) {
  const { openProject } = useProjectNavigation();
  const isDone = project.status === 'Concluído' || project.status === 'Cancelado';

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
        <span className="muted project-task-count">
          {taskCount} tarefa{taskCount === 1 ? '' : 's'}
        </span>
      </div>
    </article>
  );
}
