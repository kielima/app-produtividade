import type { CSSProperties } from 'react';
import { useProjectNavigation } from '../lib/projectNavigation';
import {
  classifyConfidence,
  classifyVolatility,
  type GlickoRating,
  type VolatilityBands,
} from '../lib/glicko2';
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
  doneTaskCount,
  glickoRating,
  volatilityBands,
}: {
  project: Project;
  taskCount: number;
  doneTaskCount: number;
  glickoRating?: GlickoRating;
  volatilityBands?: VolatilityBands;
}) {
  const { openProject, openProjectTasks } = useProjectNavigation();
  const isDone = project.status === 'Concluído' || project.status === 'Cancelado';
  const pendingCount = Math.max(0, taskCount - doneTaskCount);
  const progressPct =
    taskCount > 0 ? Math.round((doneTaskCount / taskCount) * 100) : null;
  const countLabel =
    progressPct === null
      ? `${pendingCount} tarefa${pendingCount === 1 ? '' : 's'}`
      : `${pendingCount} tarefa${pendingCount === 1 ? '' : 's'} (${progressPct}%)`;
  const statusClass = STATUS_SLUG[project.status];

  const volatility = glickoRating
    ? classifyVolatility(glickoRating.sigma, volatilityBands)
    : null;
  const confidence = glickoRating ? classifyConfidence(glickoRating.rd) : null;

  return (
    <article
      className={`project-card status-${statusClass}${isDone ? ' done' : ''}`}
      style={
        progressPct !== null
          ? ({ '--progress-pct': `${progressPct}%` } as CSSProperties)
          : undefined
      }
    >
      {progressPct !== null && (
        <span className="project-progress-fill" aria-hidden="true" />
      )}
      <div className="project-line">
        <button
          type="button"
          className="project-title project-title-btn"
          onClick={() => openProjectTasks(project.id)}
          aria-label={`ver tarefas do projeto ${project.name}`}
        >
          {project.name}
        </button>
        {volatility && confidence && (
          <span className="project-glicko-badges">
            <span
              className={`duel-card-badge duel-card-badge--${volatility}`}
              title="Volatilidade do Duelo"
            >
              Vol. {volatility}
            </span>
            <span
              className={`duel-card-badge duel-card-badge--${confidence}-conf`}
              title="Confiabilidade do Duelo"
            >
              Conf. {confidence}
            </span>
          </span>
        )}
        <button
          type="button"
          className="muted project-task-count project-task-count-btn"
          onClick={() => openProjectTasks(project.id)}
          aria-label={`ver ${countLabel} do projeto ${project.name}`}
        >
          {countLabel}
        </button>
        <button
          type="button"
          className="icon-btn project-info-btn"
          onClick={() => openProject(project.id)}
          aria-label={`informações do projeto ${project.name}`}
          title="Informações do projeto"
        >
          ⓘ
        </button>
      </div>
    </article>
  );
}
