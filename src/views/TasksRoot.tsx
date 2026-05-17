import { useEffect, useMemo, useRef } from 'react';
import { NewTaskFab } from '../components/NewTaskFab';
import type { TaskFiltersState } from '../components/TaskFiltersBar';
import {
  ESFORCO_VALUES,
  MODO_VALUES,
  MOSCOW_VALUES,
  STATUS_VALUES,
} from '../components/TaskFiltersBar';
import type { UserData } from '../lib/useUserData';
import { archiveCompletedTasks } from '../repositories/tasksRepo';
import type { Task } from '../types';
import { EsforcoView } from './EsforcoView';
import { KanbanView } from './KanbanView';
import { ModoView } from './ModoView';
import { MoscowView } from './MoscowView';
import { PrioridadeView } from './PrioridadeView';

export type TaskView =
  | 'prioridade'
  | 'kanban'
  | 'moscow'
  | 'modo'
  | 'esforco';

export const VIEW_TABS: Array<{ key: TaskView; label: string }> = [
  { key: 'prioridade', label: 'Prioridade' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'moscow', label: 'MoSCoW' },
  { key: 'modo', label: 'Modo' },
  { key: 'esforco', label: 'Esforço' },
];

// Cada visão "colunada" usa um campo como coluna; aplicar o filtro
// correspondente nessa visão esvaziaria as próprias colunas.
function applyFilters(
  tasks: Task[],
  view: TaskView,
  filters: TaskFiltersState,
): Task[] {
  const applyHideCompleted = filters.hideCompleted && view !== 'kanban';
  const applyOnlyWithoutDeadline = filters.onlyWithoutDeadline;
  const applyModo =
    view !== 'modo' && filters.modoFilter.size !== MODO_VALUES.length;
  const applyMoscow =
    view !== 'moscow' && filters.moscowFilter.size !== MOSCOW_VALUES.length;
  const applyEsforco =
    view !== 'esforco' && filters.esforcoFilter.size !== ESFORCO_VALUES.length;
  const applyStatus =
    view !== 'kanban' && filters.statusFilter.size !== STATUS_VALUES.length;
  const applyProject = !!filters.projectFilter;
  if (
    !applyHideCompleted &&
    !applyOnlyWithoutDeadline &&
    !applyModo &&
    !applyMoscow &&
    !applyEsforco &&
    !applyStatus &&
    !applyProject
  )
    return tasks;

  return tasks.filter((t) => {
    if (applyHideCompleted && t.checked) return false;
    if (applyOnlyWithoutDeadline && t.deadline) return false;
    if (applyProject && t.section !== filters.projectFilter) return false;
    if (applyModo && !filters.modoFilter.has(t.modo)) return false;
    if (applyMoscow && !filters.moscowFilter.has(t.moscow)) return false;
    if (applyEsforco && !filters.esforcoFilter.has(t.esforco)) return false;
    if (applyStatus) {
      const status: 'todo' | 'doing' | 'done' = t.checked
        ? 'done'
        : t.inProgress
          ? 'doing'
          : 'todo';
      if (!filters.statusFilter.has(status)) return false;
    }
    return true;
  });
}

export function TasksRoot({
  uid,
  view,
  data,
  filters,
}: {
  uid: string;
  view: TaskView;
  data: UserData;
  filters: TaskFiltersState;
}) {
  const archivedOnLoad = useRef(false);

  useEffect(() => {
    if (archivedOnLoad.current) return;
    archivedOnLoad.current = true;
    archiveCompletedTasks(uid).catch(() => {
      // erro silencioso — o usuário verá no próximo reload se persistir
    });
  }, [uid]);

  const filteredTasks = useMemo(
    () => applyFilters(data.tasks, view, filters),
    [data.tasks, view, filters],
  );

  if (data.error) return <p className="error">Erro: {data.error.message}</p>;

  return (
    <>
      {view === 'prioridade' && (
        <PrioridadeView
          uid={uid}
          tasks={filteredTasks}
          projectMap={data.projectMap}
          ctx={data.ctx}
          hideZero={filters.hideZero}
        />
      )}
      {view === 'kanban' && (
        <KanbanView uid={uid} tasks={filteredTasks} ctx={data.ctx} />
      )}
      {view === 'moscow' && (
        <MoscowView uid={uid} tasks={filteredTasks} ctx={data.ctx} />
      )}
      {view === 'modo' && (
        <ModoView uid={uid} tasks={filteredTasks} ctx={data.ctx} />
      )}
      {view === 'esforco' && (
        <EsforcoView uid={uid} tasks={filteredTasks} ctx={data.ctx} />
      )}
      <NewTaskFab
        uid={uid}
        projects={data.projects}
        defaultProjectId={filters.projectFilter}
      />
    </>
  );
}
