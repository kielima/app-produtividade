import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { GlickoRating, VolatilityBands } from '../lib/glicko2';
import type { Project } from '../types';
import { ProjectCard } from './ProjectCard';

/**
 * Envelope draggable em torno do ProjectCard, usado na Matriz MoSCoW. A alça
 * dedicada (⋮⋮) à esquerda evita conflito com os botões internos do card
 * (título, contador de tarefas, info).
 */
export function DraggableProjectCard({
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: project.id,
    data: { projectId: project.id, fromMoscow: project.moscow },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    touchAction: 'manipulation',
  };

  return (
    <div ref={setNodeRef} style={style} className="draggable-project">
      <button
        type="button"
        className="drag-handle"
        aria-label="arrastar para outro quadrante MoSCoW"
        {...listeners}
        {...attributes}
      >
        ⋮⋮
      </button>
      <div className="draggable-content">
        <ProjectCard
          project={project}
          taskCount={taskCount}
          doneTaskCount={doneTaskCount}
          glickoRating={glickoRating}
          volatilityBands={volatilityBands}
        />
      </div>
    </div>
  );
}
