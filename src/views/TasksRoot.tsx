import { useEffect, useRef, useState } from 'react';
import { useUserData } from '../lib/useUserData';
import { archiveCompletedTasks } from '../repositories/tasksRepo';
import { EsforcoView } from './EsforcoView';
import { KanbanView } from './KanbanView';
import { ListView } from './ListView';
import { ModoView } from './ModoView';
import { MoscowView } from './MoscowView';
import { PrioridadeView } from './PrioridadeView';

type TaskView = 'lista' | 'prioridade' | 'kanban' | 'moscow' | 'modo' | 'esforco';

const VIEW_TABS: Array<{ key: TaskView; label: string }> = [
  { key: 'lista', label: 'Lista' },
  { key: 'prioridade', label: 'Prioridade' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'moscow', label: 'MoSCoW' },
  { key: 'modo', label: 'Modo' },
  { key: 'esforco', label: 'Esforço' },
];

const STORAGE_KEY = 'app-produtividade:task-view';

function loadView(): TaskView {
  if (typeof window === 'undefined') return 'lista';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return (VIEW_TABS.find((v) => v.key === stored)?.key ?? 'lista') as TaskView;
}

/**
 * Container das views de Tarefas. Assina tasks+sections uma única vez
 * via useUserData e roteia entre as views. Roda o auto-archive uma vez
 * por sessão. Persiste a view escolhida em localStorage.
 */
export function TasksRoot({ uid }: { uid: string }) {
  const data = useUserData(uid);
  const [view, setView] = useState<TaskView>(() => loadView());
  const archivedOnLoad = useRef(false);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, view);
  }, [view]);

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
      <nav className="subtabs">
        {VIEW_TABS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={view === v.key ? 'subtab active' : 'subtab'}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {view === 'lista' && (
        <ListView uid={uid} tasks={data.tasks} sections={data.sections} ctx={data.ctx} />
      )}
      {view === 'prioridade' && (
        <PrioridadeView
          uid={uid}
          tasks={data.tasks}
          sections={data.sections}
          sectionMap={data.sectionMap}
          ctx={data.ctx}
        />
      )}
      {view === 'kanban' && (
        <KanbanView uid={uid} tasks={data.tasks} sections={data.sections} ctx={data.ctx} />
      )}
      {view === 'moscow' && (
        <MoscowView uid={uid} tasks={data.tasks} sections={data.sections} ctx={data.ctx} />
      )}
      {view === 'modo' && (
        <ModoView uid={uid} tasks={data.tasks} sections={data.sections} ctx={data.ctx} />
      )}
      {view === 'esforco' && (
        <EsforcoView uid={uid} tasks={data.tasks} sections={data.sections} ctx={data.ctx} />
      )}
    </>
  );
}
