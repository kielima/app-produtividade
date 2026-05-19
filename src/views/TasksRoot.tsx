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
import { PrioridadeView } from './PrioridadeView';

export type TaskView = 'prioridade';

export const VIEW_TABS: Array<{ key: TaskView; label: string }> = [
  { key: 'prioridade', label: 'Prioridade' },
];

function applyFilters(
  tasks: Task[],
  filters: TaskFiltersState,
): Task[] {
  const applyHideCompleted = filters.hideCompleted;
  const applyOnlyWithoutDeadline = filters.onlyWithoutDeadline;
  const applyModo = filters.modoFilter.size !== MODO_VALUES.length;
  const applyMoscow = filters.moscowFilter.size !== MOSCOW_VALUES.length;
  const applyEsforco = filters.esforcoFilter.size !== ESFORCO_VALUES.length;
  const applyStatus = filters.statusFilter.size !== STATUS_VALUES.length;
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
  data,
  filters,
}: {
  uid: string;
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
    () => applyFilters(data.tasks, filters),
    [data.tasks, filters],
  );

  if (data.error) return <p className="error">Erro: {data.error.message}</p>;

  return (
    <>
      <PrioridadeView
        uid={uid}
        tasks={filteredTasks}
        projectMap={data.projectMap}
        ctx={data.ctx}
        hideZero={filters.hideZero}
      />
      <NewTaskFab
        uid={uid}
        projects={data.projects}
        defaultProjectId={filters.projectFilter}
      />
    </>
  );
}
