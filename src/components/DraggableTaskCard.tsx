import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Section, Task } from '../types';
import { TaskCard } from './TaskCard';

/**
 * Envelope draggable em torno do TaskCard. Aplica `listeners` em uma alça
 * dedicada (⋮⋮) à esquerda do card para não conflitar com checkbox/inputs
 * /badges/inline edit que já consomem cliques no card.
 */
export function DraggableTaskCard({
  uid,
  task,
  blocked,
  sections,
  allTasks,
}: {
  uid: string;
  task: Task;
  blocked: boolean;
  sections: Section[];
  allTasks: Task[];
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
        aria-label="arrastar para outra seção"
        {...listeners}
        {...attributes}
      >
        ⋮⋮
      </button>
      <div className="draggable-content">
        <TaskCard
          uid={uid}
          task={task}
          blocked={blocked}
          sections={sections}
          allTasks={allTasks}
        />
      </div>
    </div>
  );
}
