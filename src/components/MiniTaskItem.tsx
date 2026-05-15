import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';
import { getDisplayTitle } from '../lib/parser';
import type { MoSCoW, Task } from '../types';

const MOSCOW_SHORT: Record<MoSCoW, string> = {
  must: 'M',
  should: 'S',
  could: 'C',
  wont: 'W',
  '': '',
};

/**
 * Item compacto de tarefa, draggable. Usado no Calendário (sidebar e
 * dentro de cada célula do dia). Mostra display title truncado e um
 * mini-badge de MoSCoW.
 */
export function MiniTaskItem({
  task,
  badge,
}: {
  task: Task;
  badge?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { taskId: task.id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    touchAction: 'manipulation',
  };

  const moscowChar = MOSCOW_SHORT[task.moscow];
  const title = getDisplayTitle(task.title);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mini-task moscow-${task.moscow || 'none'}`}
      title={title}
      {...listeners}
      {...attributes}
    >
      {moscowChar && <span className="mini-task-prio">{moscowChar}</span>}
      <span className="mini-task-title">{title}</span>
      {badge && <span className="mini-task-badge">{badge}</span>}
    </div>
  );
}

/**
 * Célula de dia no calendário, dropzone. `id` deve ser `day:YYYY-MM-DD`.
 */
export function DroppableDay({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ''}${isOver ? ' is-over' : ''}`}
    >
      {children}
    </div>
  );
}
