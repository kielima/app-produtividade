import { Fragment, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
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
import type { Subtask } from '../types';
import TrashIcon from './TrashIcon';
import { InlineEdit } from './InlineEdit';

let __subtaskUid = 0;
function nextSubtaskKey() {
  __subtaskUid += 1;
  return `sk-${__subtaskUid}`;
}

export function SubtaskList({
  subtasks,
  onChange,
}: {
  subtasks: Subtask[];
  onChange: (next: Subtask[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // Mantém uma chave estável por subtarefa para o @dnd-kit, sem depender do
  // índice (que muda ao reordenar). Quando o tamanho da lista vinda do pai
  // muda, sincronizamos preservando as chaves existentes na ordem atual.
  const keysRef = useRef<string[]>([]);
  if (keysRef.current.length !== subtasks.length) {
    const old = keysRef.current;
    const next: string[] = [];
    for (let i = 0; i < subtasks.length; i++) {
      next.push(old[i] ?? nextSubtaskKey());
    }
    keysRef.current = next;
  }
  const keys = keysRef.current;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Uma subtarefa está bloqueada quando depende da anterior (blockedByPrev) e
  // essa anterior ainda não foi concluída.
  function isBlocked(idx: number) {
    return idx > 0 && !!subtasks[idx].blockedByPrev && !subtasks[idx - 1].checked;
  }

  function toggle(idx: number) {
    if (isBlocked(idx)) return;
    onChange(subtasks.map((s, i) => (i === idx ? { ...s, checked: !s.checked } : s)));
  }

  function remove(idx: number) {
    keysRef.current = keysRef.current.filter((_, i) => i !== idx);
    // Ao remover, a subtarefa seguinte deixa de poder depender da anterior por
    // posição; limpamos esse vínculo para não criar dependência inesperada.
    onChange(
      subtasks
        .filter((_, i) => i !== idx)
        .map((s, i) => (i === idx ? { ...s, blockedByPrev: false } : s)),
    );
  }

  // Alterna a dependência da subtarefa em `idx` face à subtarefa anterior.
  function toggleLink(idx: number) {
    if (idx <= 0) return;
    onChange(
      subtasks.map((s, i) =>
        i === idx ? { ...s, blockedByPrev: !s.blockedByPrev } : s,
      ),
    );
  }

  function rename(idx: number, text: string) {
    if (!text) {
      remove(idx);
      return;
    }
    onChange(subtasks.map((s, i) => (i === idx ? { ...s, text } : s)));
  }

  function add() {
    const t = draft.trim();
    if (!t) {
      setAdding(false);
      setDraft('');
      return;
    }
    keysRef.current = [...keysRef.current, nextSubtaskKey()];
    onChange([...subtasks, { text: t, checked: false }]);
    setDraft('');
    setAdding(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = keys.indexOf(String(active.id));
    const newIndex = keys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    keysRef.current = arrayMove(keys, oldIndex, newIndex);
    onChange(arrayMove(subtasks, oldIndex, newIndex));
  }

  return (
    <ul className="subtasks">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          {subtasks.map((s, i) => (
            <Fragment key={keys[i]}>
              {i > 0 && (
                <li className="subtask-link-row">
                  <button
                    type="button"
                    className={
                      'subtask-link-btn' + (s.blockedByPrev ? ' linked' : '')
                    }
                    onClick={() => toggleLink(i)}
                    aria-pressed={!!s.blockedByPrev}
                    title={
                      s.blockedByPrev
                        ? 'Remover dependência: esta subtarefa deixa de ficar bloqueada pela anterior'
                        : 'Criar dependência: esta subtarefa fica bloqueada até a anterior ser concluída'
                    }
                    aria-label={
                      s.blockedByPrev
                        ? 'remover dependência entre subtarefas'
                        : 'criar dependência entre subtarefas'
                    }
                  >
                    <LinkIcon size={16} />
                  </button>
                </li>
              )}
              <SortableSubtaskRow
                id={keys[i]}
                subtask={s}
                blocked={isBlocked(i)}
                onToggle={() => toggle(i)}
                onRename={(v) => rename(i, v)}
                onRemove={() => remove(i)}
              />
            </Fragment>
          ))}
        </SortableContext>
      </DndContext>
      {adding ? (
        <li className="subtask-add-row">
          <input
            type="text"
            className="inline-edit-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            placeholder="Nova subtarefa…"
            autoFocus
          />
        </li>
      ) : (
        <li>
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            + adicionar subtarefa
          </button>
        </li>
      )}
    </ul>
  );
}

function LinkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SortableSubtaskRow({
  id,
  subtask,
  blocked,
  onToggle,
  onRename,
  onRemove,
}: {
  id: string;
  subtask: Subtask;
  blocked: boolean;
  onToggle: () => void;
  onRename: (v: string) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        (subtask.checked ? 'done' : '') + (blocked ? ' subtask-blocked' : '')
      }
    >
      <button
        type="button"
        className="subtask-drag-handle"
        aria-label="arrastar para reordenar"
        {...attributes}
        {...listeners}
      >
        <svg
          width="12"
          height="18"
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
      <input
        type="checkbox"
        checked={subtask.checked}
        onChange={onToggle}
        disabled={blocked}
        aria-label="alternar subtarefa"
        title={blocked ? 'Bloqueada: conclua a subtarefa anterior primeiro' : undefined}
      />
      <InlineEdit value={subtask.text} onSave={onRename} className="subtask-text" />
      <button
        type="button"
        className="icon-btn"
        onClick={onRemove}
        aria-label="remover subtarefa"
      >
        <TrashIcon size={18} />
      </button>
    </li>
  );
}
