import { useEffect, useRef } from 'react';
import { useUserData } from '../lib/useUserData';
import { archiveCompletedTasks } from '../repositories/tasksRepo';
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

export function TasksRoot({
  uid,
  view,
}: {
  uid: string;
  view: TaskView;
}) {
  const data = useUserData(uid);
  const archivedOnLoad = useRef(false);

  useEffect(() => {
    if (archivedOnLoad.current) return;
    archivedOnLoad.current = true;
    archiveCompletedTasks(uid).catch(() => {
      // erro silencioso — o usuário verá no próximo reload se persistir
    });
  }, [uid]);

  if (data.error) return <p className="error">Erro: {data.error.message}</p>;

  return (
    <>
      {view === 'lista' && (
        <ListView uid={uid} tasks={data.tasks} projects={data.projects} ctx={data.ctx} />
      )}
      {view === 'board' && (
        <BoardView
          uid={uid}
          tasks={data.tasks}
          projects={data.projects}
          projectMap={data.projectMap}
          ctx={data.ctx}
        />
      )}
      {view === 'prioridade' && (
        <PrioridadeView
          uid={uid}
          tasks={data.tasks}
          projects={data.projects}
          projectMap={data.projectMap}
          ctx={data.ctx}
        />
      )}
      {view === 'kanban' && (
        <KanbanView uid={uid} tasks={data.tasks} projects={data.projects} ctx={data.ctx} />
      )}
      {view === 'moscow' && (
        <MoscowView uid={uid} tasks={data.tasks} projects={data.projects} ctx={data.ctx} />
      )}
      {view === 'modo' && (
        <ModoView uid={uid} tasks={data.tasks} projects={data.projects} ctx={data.ctx} />
      )}
      {view === 'esforco' && (
        <EsforcoView uid={uid} tasks={data.tasks} projects={data.projects} ctx={data.ctx} />
      )}
    </>
  );
}
