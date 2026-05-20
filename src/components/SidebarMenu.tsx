import { useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export type MenuItem = {
  key: string;
  label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  onReorder: (keys: string[]) => void;
  onSignOut: () => void;
};

export function SidebarMenu({
  open,
  onClose,
  items,
  activeKey,
  onSelect,
  onReorder,
  onSignOut,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.key === active.id);
    const newIndex = items.findIndex((i) => i.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(items, oldIndex, newIndex).map((i) => i.key);
    onReorder(next);
  }

  return (
    <>
      <div
        className={open ? 'sidebar-backdrop open' : 'sidebar-backdrop'}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={open ? 'sidebar open' : 'sidebar'}
        role="dialog"
        aria-modal="true"
        aria-label="Menu principal"
        aria-hidden={!open}
      >
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="Fechar menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="seções principais">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((i) => i.key)}
              strategy={verticalListSortingStrategy}
            >
              {items.map((item) => (
                <SortableSidebarItem
                  key={item.key}
                  item={item}
                  active={activeKey === item.key}
                  onSelect={() => {
                    onSelect(item.key);
                    onClose();
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-item"
            onClick={() => {
              onSignOut();
              onClose();
            }}
          >
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}

function SortableSidebarItem({
  item,
  active,
  onSelect,
}: {
  item: MenuItem;
  active: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'sidebar-row dragging' : 'sidebar-row'}
    >
      <button
        type="button"
        className={active ? 'sidebar-item active' : 'sidebar-item'}
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
      >
        {item.label}
      </button>
      <button
        type="button"
        className="sidebar-drag-handle"
        aria-label={`Arrastar ${item.label}`}
        {...attributes}
        {...listeners}
      >
        <svg
          width="14"
          height="20"
          viewBox="0 0 14 20"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="4" cy="4" r="1.4" fill="currentColor" />
          <circle cx="10" cy="4" r="1.4" fill="currentColor" />
          <circle cx="4" cy="10" r="1.4" fill="currentColor" />
          <circle cx="10" cy="10" r="1.4" fill="currentColor" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" />
          <circle cx="10" cy="16" r="1.4" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
