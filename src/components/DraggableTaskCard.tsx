import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../types';
import { TaskCard } from './TaskCard';

/**
 * Envelope draggable em torno do TaskCard. Aplica `listeners` em uma alça
 * dedicada (⋮⋮) à esquerda do card para não conflitar com o checkbox e o
 * botão do título.
 */
export function DraggableTaskCard({
  uid,
  task,
  blocked,
}: {
  uid: string;
  task: Task;
  blocked: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { taskId: task.id, fromSection: task.section },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    touchAction: 'manipulation',
  };

  return (
    <div ref={setNodeRef} style={style} className="draggable-task">
      <button
        type="button"
        className="drag-handle"
        aria-label="arrastar para outro projeto"
        {...listeners}
        {...attributes}
      >
        ⋮⋮
      </button>
      <div className="draggable-content">
        <TaskCard uid={uid} task={task} blocked={blocked} />
      </div>
    </div>
  );
}
