import { useEffect, useMemo, useRef } from 'react';
import { NewTaskFab } from '../components/NewTaskFab';
import type { TaskFiltersState } from '../components/TaskFiltersBar';
import {
  ESFORCO_VALUES,
  MODO_VALUES,
  MOSCOW_VALUES,
  STATUS_VALUES,
} from '../components/TaskFiltersBar';
import { normalizeForSearch } from '../lib/searchNormalize';
import { isSnoozed } from '../lib/snooze';
import { buildChildStatsMap } from '../lib/taskHierarchy';
import type { UserData } from '../lib/useUserData';
import { migrateCompletedTasksIntoTasks } from '../repositories/tasksRepo';
import type { Task } from '../types';
import { PrioridadeView } from './PrioridadeView';

export type TaskView = 'prioridade';

export const VIEW_TABS: Array<{ key: TaskView; label: string }> = [
  { key: 'prioridade', label: 'Prioridade' },
];

function applyFilters(
  tasks: Task[],
  filters: TaskFiltersState,
  searchQuery: string,
): Task[] {
  const applyHideCompleted = filters.hideCompleted;
  const applyHideSnoozed = filters.hideSnoozed;
  const applyOnlyWithoutDeadline = filters.onlyWithoutDeadline;
  const applyModo = filters.modoFilter.size !== MODO_VALUES.length;
  const applyMoscow = filters.moscowFilter.size !== MOSCOW_VALUES.length;
  const applyEsforco = filters.esforcoFilter.size !== ESFORCO_VALUES.length;
  const applyStatus = filters.statusFilter.size !== STATUS_VALUES.length;
  const applyProject = !!filters.projectFilter;
  const q = normalizeForSearch(searchQuery.trim());
  const applySearch = q.length > 0;
  if (
    !applyHideCompleted &&
    !applyHideSnoozed &&
    !applyOnlyWithoutDeadline &&
    !applyModo &&
    !applyMoscow &&
    !applyEsforco &&
    !applyStatus &&
    !applyProject &&
    !applySearch
  )
    return tasks;

  return tasks.filter((t) => {
    if (applyHideCompleted && t.checked) return false;
    // Tarefas adiadas só somem se ainda não concluídas — uma tarefa adiada
    // que foi concluída deve continuar visível ao desligar "concluídas".
    if (applyHideSnoozed && !t.checked && isSnoozed(t)) return false;
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
    if (applySearch) {
      const haystack = normalizeForSearch(
        [t.title, t.note, ...t.subtasks.map((s) => s.text)].join('\n'),
      );
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function TasksRoot({
  uid,
  data,
  filters,
  searchQuery,
}: {
  uid: string;
  data: UserData;
  filters: TaskFiltersState;
  searchQuery: string;
}) {
  const migratedOnLoad = useRef(false);

  useEffect(() => {
    if (migratedOnLoad.current) return;
    migratedOnLoad.current = true;
    migrateCompletedTasksIntoTasks(uid).catch(() => {
      // erro silencioso — a próxima montagem tenta de novo se persistir
    });
  }, [uid]);

  // Subtarefas (filhas) ficam ocultas da lista principal — só aparecem dentro
  // da página do pai. Mantemos `data.tasks` completo para calcular o progresso
  // das filhas via `childStats`.
  const childStats = useMemo(() => buildChildStatsMap(data.tasks), [data.tasks]);
  const filteredTasks = useMemo(
    () => applyFilters(data.tasks.filter((t) => !t.parentId), filters, searchQuery),
    [data.tasks, filters, searchQuery],
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
        childStats={childStats}
      />
      <NewTaskFab
        uid={uid}
        projects={data.projects}
        defaultProjectId={filters.projectFilter}
      />
    </>
  );
}
