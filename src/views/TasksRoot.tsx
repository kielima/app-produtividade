import { useMemo } from 'react';
import { NewTaskFab } from '../components/NewTaskFab';
import type { TaskFiltersState } from '../components/TaskFiltersBar';
import {
  ESFORCO_VALUES,
  MODO_VALUES,
  MOSCOW_VALUES,
  STATUS_VALUES,
} from '../components/TaskFiltersBar';
import { normalizeForSearch } from '../lib/searchNormalize';
import { NO_TAG_FILTER } from '../lib/tags';
import { isSnoozed } from '../lib/snooze';
import { buildChildStatsMap, isTopLevel } from '../lib/taskHierarchy';
import type { UserData } from '../lib/useUserData';
import type { Task } from '../types';
import { GanttView } from './GanttView';
import { PrioridadeView } from './PrioridadeView';
import { TaskMoscowMatrix } from './TaskMoscowMatrix';

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
  const applyTags = filters.tagFilter.length > 0;
  const wantNoTag = filters.tagFilter.includes(NO_TAG_FILTER);
  const requiredTags = filters.tagFilter.filter((t) => t !== NO_TAG_FILTER);
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
    !applyTags &&
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
    if (applyTags) {
      if (wantNoTag && t.tags.length > 0) return false;
      if (requiredTags.length > 0) {
        const taskTags = new Set(t.tags);
        for (const tag of requiredTags) if (!taskTags.has(tag)) return false;
      }
    }
    if (applySearch) {
      const haystack = normalizeForSearch([t.title, t.note, ...t.tags].join('\n'));
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
  // Subtarefas (filhas) ficam ocultas da lista principal — só aparecem dentro
  // da página do pai. Mantemos `data.tasks` completo para calcular o progresso
  // das filhas via `childStats`. Tarefas com `parentId` órfão (pai apagado sem
  // desvincular as filhas) voltam a ser tratadas como de topo, senão ficariam
  // escondidas para sempre.
  const childStats = useMemo(() => buildChildStatsMap(data.tasks), [data.tasks]);
  const filteredTasks = useMemo(
    () =>
      applyFilters(
        data.tasks.filter((t) => isTopLevel(t, data.tasks)),
        filters,
        searchQuery,
      ),
    [data.tasks, filters, searchQuery],
  );

  if (data.error) return <p className="error">Erro: {data.error.message}</p>;

  return (
    <>
      {filters.viewMode === 'matrix' ? (
        <TaskMoscowMatrix
          uid={uid}
          tasks={filteredTasks}
          projectMap={data.projectMap}
          ctx={data.ctx}
          hideZero={filters.hideZero}
        />
      ) : filters.viewMode === 'gantt' ? (
        <GanttView tasks={filteredTasks} projectMap={data.projectMap} ctx={data.ctx} />
      ) : (
        <PrioridadeView
          uid={uid}
          tasks={filteredTasks}
          projectMap={data.projectMap}
          ctx={data.ctx}
          hideZero={filters.hideZero}
          childStats={childStats}
        />
      )}
      <NewTaskFab
        uid={uid}
        projects={data.projects}
        defaultProjectId={filters.projectFilter}
      />
    </>
  );
}
