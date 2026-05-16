import { useEffect, useMemo, useRef } from 'react';
import type { TaskFiltersState } from '../components/TaskFiltersBar';
import { MODO_VALUES } from '../components/TaskFiltersBar';
import type { UserData } from '../lib/useUserData';
import { archiveCompletedTasks } from '../repositories/tasksRepo';
import type { Task } from '../types';
import { BoardView } from './BoardView';
import { EsforcoView } from './EsforcoView';
import { KanbanView } from './KanbanView';
import { ListView } from './ListView';
import { ModoView } from './ModoView';
import { MoscowView } from './MoscowView';
import { PrioridadeView } from './PrioridadeView';

export type TaskView =
  | 'lista'
  | 'board'
  | 'prioridade'
  | 'kanban'
  | 'moscow'
  | 'modo'
  | 'esforco';

export const VIEW_TABS: Array<{ key: TaskView; label: string }> = [
  { key: 'prioridade', label: 'Prioridade' },
  { key: 'lista', label: 'Lista' },
  { key: 'board', label: 'Board' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'moscow', label: 'MoSCoW' },
  { key: 'modo', label: 'Modo' },
  { key: 'esforco', label: 'Esforço' },
];

// Kanban usa "Concluída" como coluna; ocultar completas esconderia a coluna.
// Modo usa o próprio modo como coluna; filtrar por modo aqui esvaziaria colunas.
function applyFilters(
  tasks: Task[],
  view: TaskView,
  filters: TaskFiltersState,
): Task[] {
  const applyHideCompleted = filters.hideCompleted && view !== 'kanban';
  const applyModo =
    view !== 'modo' && filters.modoFilter.size !== MODO_VALUES.length;
  const applyProject = !!filters.projectFilter;
  if (!applyHideCompleted && !applyModo && !applyProject) return tasks;

  return tasks.filter((t) => {
    if (applyHideCompleted && t.checked) return false;
    if (applyProject && t.section !== filters.projectFilter) return false;
    if (applyModo && !filters.modoFilter.has(t.modo)) return false;
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
      {view === 'lista' && (
        <ListView
          uid={uid}
          tasks={filteredTasks}
          totalCount={data.tasks.length}
          projects={data.projects}
          projectFilter={filters.projectFilter}
          ctx={data.ctx}
        />
      )}
      {view === 'board' && (
        <BoardView
          uid={uid}
          tasks={filteredTasks}
          projects={data.projects}
          projectMap={data.projectMap}
          projectFilter={filters.projectFilter}
          ctx={data.ctx}
        />
      )}
      {view === 'prioridade' && (
        <PrioridadeView
          uid={uid}
          tasks={filteredTasks}
          projects={data.projects}
          projectMap={data.projectMap}
          ctx={data.ctx}
          hideZero={filters.hideZero}
        />
      )}
      {view === 'kanban' && (
        <KanbanView
          uid={uid}
          tasks={filteredTasks}
          projects={data.projects}
          ctx={data.ctx}
        />
      )}
      {view === 'moscow' && (
        <MoscowView
          uid={uid}
          tasks={filteredTasks}
          projects={data.projects}
          ctx={data.ctx}
        />
      )}
      {view === 'modo' && (
        <ModoView
          uid={uid}
          tasks={filteredTasks}
          projects={data.projects}
          ctx={data.ctx}
        />
      )}
      {view === 'esforco' && (
        <EsforcoView
          uid={uid}
          tasks={filteredTasks}
          projects={data.projects}
          ctx={data.ctx}
        />
      )}
    </>
  );
}
