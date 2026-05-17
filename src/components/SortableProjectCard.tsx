import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Project } from '../types';
import { ProjectCard } from './ProjectCard';

/**
 * Envelope sortable em torno do ProjectCard. A alça (⋮⋮) à esquerda recebe
 * `listeners` para não conflitar com o título clicável do card.
 */
export function SortableProjectCard({
  project,
  taskCount,
  disabled,
}: {
  project: Project;
  taskCount: number;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: project.id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    touchAction: 'manipulation',
  };

  return (
    <div ref={setNodeRef} style={style} className="sortable-project">
      {!disabled && (
        <button
          type="button"
          className="drag-handle project-drag-handle"
          aria-label="arrastar para reordenar projeto"
          {...listeners}
          {...attributes}
        >
          ⋮⋮
        </button>
      )}
      <div className="sortable-project-content">
        <ProjectCard project={project} taskCount={taskCount} />
      </div>
    </div>
  );
}
