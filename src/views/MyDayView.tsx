import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskCard } from '../components/TaskCard';
import { getMyDayTasks, removeFromMyDay, reorderMyDay } from '../lib/myDay';
import { isTaskBlocked } from '../lib/score';
import { buildChildStatsMap } from '../lib/taskHierarchy';
import type { Project, ScoreContext, Task } from '../types';

type Props = {
  uid: string;
  tasks: Task[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
  commentCounts?: Record<string, number>;
};

export function MyDayView({ uid, tasks, projectMap, ctx, commentCounts }: Props) {
  const childStatsMap = useMemo(() => buildChildStatsMap(tasks), [tasks]);
  const stored = useMemo(() => getMyDayTasks(tasks), [tasks]);

  // Cópia local da ordem: o arrasto precisa refletir na hora, sem esperar a
  // gravação no Supabase (e o eco do Realtime) voltar. Re-sincroniza sempre
  // que a lista persistida muda — inclusive quando outra aba/dispositivo
  // mexe nela.
  const [order, setOrder] = useState<string[]>(() => stored.map((t) => t.id));
  // Enquanto uma gravação de reordenação está em andamento, os ecos parciais
  // do Realtime (uma tarefa por vez) não devem sobrescrever a ordem otimista,
  // senão a lista pisca por estados intermediários.
  const savingRef = useRef(0);
  const storedRef = useRef(stored);
  storedRef.current = stored;
  useEffect(() => {
    if (savingRef.current > 0) return;
    setOrder(stored.map((t) => t.id));
  }, [stored]);

  const [activeId, setActiveId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(stored.map((t) => [t.id, t])), [stored]);
  const items = order.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  const doneCount = items.filter((t) => t.checked).length;

  // Mouse: arrasta após mover alguns pixels (um clique simples segue
  // funcionando). Toque: é preciso SEGURAR a tarefa um instante antes de
  // arrastar — sem isso, rolar a lista com o dedo iniciaria um arrasto.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    savingRef.current += 1;
    reorderMyDay(uid, next, stored)
      .catch((e) => {
        window.alert(e instanceof Error ? e.message : 'Não foi possível salvar a nova ordem.');
      })
      .finally(() => {
        savingRef.current -= 1;
        // Com sucesso, `stored` já reflete a nova ordem; com falha, volta ao
        // que está de fato salvo (desfaz a ordem otimista).
        if (savingRef.current === 0) setOrder(storedRef.current.map((t) => t.id));
      });
  }

  async function clearCompleted() {
    try {
      await Promise.all(items.filter((t) => t.checked).map((t) => removeFromMyDay(uid, t)));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível atualizar a lista.');
    }
  }

  const activeTask = activeId ? byId.get(activeId) : undefined;

  function renderCard(task: Task) {
    return (
      <TaskCard
        uid={uid}
        task={task}
        blocked={isTaskBlocked(task, ctx)}
        projectName={projectMap[task.section]?.name}
        childStats={childStatsMap[task.id]}
        commentCount={commentCounts?.[task.id]}
      />
    );
  }

  return (
    <section className="my-day" aria-label="Meu dia">
      <header className="my-day-header">
        <h2 className="my-day-title">Meu dia</h2>
        {items.length > 0 && (
          <span className="muted my-day-count">
            {doneCount}/{items.length} concluída{items.length === 1 ? '' : 's'}
          </span>
        )}
        {doneCount > 0 && (
          <button type="button" className="my-day-clear" onClick={clearCompleted}>
            Limpar concluídas
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <p className="muted my-day-empty">
          Nenhuma tarefa no seu dia ainda. Toque no ☀️ de qualquer tarefa para
          adicioná-la aqui.
        </p>
      ) : (
        <>
          <p className="muted my-day-hint">
            Segure uma tarefa e arraste para mudar a ordem.
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <div className="task-list">
                {items.map((task) => (
                  <SortableMyDayItem key={task.id} id={task.id}>
                    {renderCard(task)}
                  </SortableMyDayItem>
                ))}
              </div>
            </SortableContext>
            <DragOverlay>{activeTask ? renderCard(activeTask) : null}</DragOverlay>
          </DndContext>
        </>
      )}
    </section>
  );
}

function SortableMyDayItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  // Os listeners vão no item inteiro (não numa alça): é o "segurar a tarefa
  // e arrastar" pedido. O checkbox, o título e o botão ☀️ continuam clicáveis
  // porque o arrasto só começa após mover (mouse) ou segurar (toque).
  return (
    <div ref={setNodeRef} style={style} className="my-day-item" {...attributes} {...listeners}>
      {children}
    </div>
  );
}
