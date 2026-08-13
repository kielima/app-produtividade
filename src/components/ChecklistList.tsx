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
import type { ChecklistItem } from '../types';
import LinkIcon from './LinkIcon';
import TrashIcon from './TrashIcon';
import { InlineEdit } from './InlineEdit';

let __itemUid = 0;
function nextItemKey() {
  __itemUid += 1;
  return `ck-${__itemUid}`;
}

/**
 * Lista de verificação de uma anotação: itens com checkbox, reordenáveis e
 * opcionalmente encadeados (um item fica bloqueado até o anterior ser
 * concluído). Usada só pelas anotações — tarefas usam tarefas-filhas.
 */
export function ChecklistList({
  items,
  onChange,
}: {
  items: ChecklistItem[];
  onChange: (next: ChecklistItem[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // Mantém uma chave estável por item para o @dnd-kit, sem depender do
  // índice (que muda ao reordenar). Quando o tamanho da lista vinda do pai
  // muda, sincronizamos preservando as chaves existentes na ordem atual.
  const keysRef = useRef<string[]>([]);
  if (keysRef.current.length !== items.length) {
    const old = keysRef.current;
    const next: string[] = [];
    for (let i = 0; i < items.length; i++) {
      next.push(old[i] ?? nextItemKey());
    }
    keysRef.current = next;
  }
  const keys = keysRef.current;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Um item está bloqueado quando depende do anterior (blockedByPrev) e
  // esse anterior ainda não foi concluído.
  function isBlocked(idx: number) {
    return idx > 0 && !!items[idx].blockedByPrev && !items[idx - 1].checked;
  }

  function toggle(idx: number) {
    if (isBlocked(idx)) return;
    onChange(items.map((s, i) => (i === idx ? { ...s, checked: !s.checked } : s)));
  }

  function remove(idx: number) {
    keysRef.current = keysRef.current.filter((_, i) => i !== idx);
    // Ao remover, o item seguinte deixa de poder depender do anterior por
    // posição; limpamos esse vínculo para não criar dependência inesperada.
    onChange(
      items
        .filter((_, i) => i !== idx)
        .map((s, i) => (i === idx ? { ...s, blockedByPrev: false } : s)),
    );
  }

  // Alterna a dependência do item em `idx` face ao item anterior.
  function toggleLink(idx: number) {
    if (idx <= 0) return;
    onChange(
      items.map((s, i) =>
        i === idx ? { ...s, blockedByPrev: !s.blockedByPrev } : s,
      ),
    );
  }

  function rename(idx: number, text: string) {
    if (!text) {
      remove(idx);
      return;
    }
    onChange(items.map((s, i) => (i === idx ? { ...s, text } : s)));
  }

  function add() {
    const t = draft.trim();
    if (!t) {
      setAdding(false);
      setDraft('');
      return;
    }
    keysRef.current = [...keysRef.current, nextItemKey()];
    onChange([...items, { text: t, checked: false }]);
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
    onChange(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <ul className="subtasks">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          {items.map((s, i) => (
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
                        ? 'Remover dependência: este item deixa de ficar bloqueado pelo anterior'
                        : 'Criar dependência: este item fica bloqueado até o anterior ser concluído'
                    }
                    aria-label={
                      s.blockedByPrev
                        ? 'remover dependência entre itens'
                        : 'criar dependência entre itens'
                    }
                  >
                    <LinkIcon size={16} />
                  </button>
                </li>
              )}
              <SortableChecklistRow
                id={keys[i]}
                item={s}
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
            placeholder="Novo item…"
            autoFocus
          />
        </li>
      ) : (
        <li>
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            + adicionar item
          </button>
        </li>
      )}
    </ul>
  );
}

function SortableChecklistRow({
  id,
  item,
  blocked,
  onToggle,
  onRename,
  onRemove,
}: {
  id: string;
  item: ChecklistItem;
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
        (item.checked ? 'done' : '') + (blocked ? ' subtask-blocked' : '')
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
        checked={item.checked}
        onChange={onToggle}
        disabled={blocked}
        aria-label="alternar item"
        title={blocked ? 'Bloqueado: conclua o item anterior primeiro' : undefined}
      />
      <InlineEdit value={item.text} onSave={onRename} className="subtask-text" />
      <button
        type="button"
        className="icon-btn"
        onClick={onRemove}
        aria-label="remover item"
      >
        <TrashIcon size={18} />
      </button>
    </li>
  );
}
