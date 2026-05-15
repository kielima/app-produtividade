import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';

/**
 * Marca uma seção como zona-alvo de drop. Aplica visual quando uma task
 * arrastada está pairando sobre ela.
 */
export function DroppableSection({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`droppable-section${isOver ? ' is-over' : ''}`}>
      {children}
    </div>
  );
}
