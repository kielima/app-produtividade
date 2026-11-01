import { useMemo } from 'react';
import { NewTaskFab } from '../components/NewTaskFab';
import type { TaskFiltersState } from '../components/TaskFiltersBar';
import {
  ESFORCO_VALUES,
  MOSCOW_VALUES,
  NO_RESPONSAVEL_FILTER,
  STATUS_VALUES,
} from '../components/TaskFiltersBar';
import { normalizeForSearch } from '../lib/searchNormalize';
import { NO_TAG_FILTER } from '../lib/tags';
import { isSnoozed } from '../lib/snooze';
import { buildChildStatsMap, isTopLevel } from '../lib/taskHierarchy';
import type { UserData } from '../lib/useUserData';
import type { Note, Task } from '../types';
import { useNoteNavigation } from '../lib/noteNavigation';
import { useProjectNavigation } from '../lib/projectNavigation';
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
  aguardando: ReadonlySet<string>,
): Task[] {
  const applyAwaiting = filters.onlyAwaitingReply;
  const applyHideCompleted = filters.hideCompleted;
  const applyHideSnoozed = filters.hideSnoozed;
  const applyOnlyWithoutDeadline = filters.onlyWithoutDeadline;
  const applyResponsavel = filters.responsavelFilter.length > 0;
  const responsaveis = new Set(filters.responsavelFilter);
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
    !applyResponsavel &&
    !applyAwaiting &&
    !applyMoscow &&
    !applyEsforco &&
    !applyStatus &&
    !applyProject &&
    !applyTags &&
    !applySearch
  )
    return tasks;

  return tasks.filter((t) => {
    if (applyAwaiting && !aguardando.has(t.id)) return false;
    if (applyHideCompleted && t.checked) return false;
    // Tarefas adiadas só somem se ainda não concluídas — uma tarefa adiada
    // que foi concluída deve continuar visível ao desligar "concluídas".
    if (applyHideSnoozed && !t.checked && isSnoozed(t)) return false;
    if (applyOnlyWithoutDeadline && t.deadline) return false;
    if (applyProject && t.section !== filters.projectFilter) return false;
    if (applyResponsavel && !responsaveis.has(t.responsavelId || NO_RESPONSAVEL_FILTER)) return false;
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
  notes = [],
}: {
  uid: string;
  data: UserData;
  filters: TaskFiltersState;
  searchQuery: string;
  // Para o filtro "esperando minha resposta", que mostra também as notas.
  notes?: Note[];
}) {
  const { openNote } = useNoteNavigation();
  const { openProject } = useProjectNavigation();
  // Subtarefas (filhas) ficam ocultas da lista principal — só aparecem dentro
  // da página do pai. Mantemos `data.tasks` completo para calcular o progresso
  // das filhas via `childStats`. Tarefas com `parentId` órfão (pai apagado sem
  // desvincular as filhas) voltam a ser tratadas como de topo, senão ficariam
  // escondidas para sempre.
  const childStats = useMemo(() => buildChildStatsMap(data.tasks), [data.tasks]);
  // Com "esperando minha resposta", subtarefas também entram: a pergunta do
  // secretário pode estar numa filha, e escondê-la sumiria com a pergunta.
  const filteredTasks = useMemo(
    () =>
      applyFilters(
        filters.onlyAwaitingReply ? data.tasks : data.tasks.filter((t) => isTopLevel(t, data.tasks)),
        filters,
        searchQuery,
        data.aguardandoTarefas,
      ),
    [data.tasks, filters, searchQuery, data.aguardandoTarefas],
  );
  const notasAguardando = useMemo(
    () =>
      filters.onlyAwaitingReply
        ? notes.filter((n) => data.aguardandoNotas.has(n.id)).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
        : [],
    [filters.onlyAwaitingReply, notes, data.aguardandoNotas],
  );
  const projetosAguardando = useMemo(
    () =>
      filters.onlyAwaitingReply
        ? data.projects
            .filter((p) => data.aguardandoProjetos.has(p.id))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        : [],
    [filters.onlyAwaitingReply, data.projects, data.aguardandoProjetos],
  );

  if (data.error) return <p className="error">Erro: {data.error.message}</p>;

  return (
    <>
      {filters.onlyAwaitingReply && (
        <section className="aguardando-resposta">
          <p className="aguardando-resposta-titulo">
            💬 Esperando sua resposta: {filteredTasks.length}{' '}
            {filteredTasks.length === 1 ? 'tarefa' : 'tarefas'}, {projetosAguardando.length}{' '}
            {projetosAguardando.length === 1 ? 'projeto' : 'projetos'} e {notasAguardando.length}{' '}
            {notasAguardando.length === 1 ? 'nota' : 'notas'}. Responda nos comentários de cada um.
          </p>
          {projetosAguardando.length > 0 && (
            <ul className="aguardando-notas">
              {projetosAguardando.map((p) => (
                <li key={p.id}>
                  <button type="button" className="aguardando-nota" onClick={() => openProject(p.id)}>
                    📁 {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {notasAguardando.length > 0 && (
            <ul className="aguardando-notas">
              {notasAguardando.map((n) => (
                <li key={n.id}>
                  <button type="button" className="aguardando-nota" onClick={() => openNote(n.id)}>
                    🗒️ {n.title || '(nota sem título)'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {filters.viewMode === 'matrix' ? (
        <TaskMoscowMatrix
          uid={uid}
          tasks={filteredTasks}
          projectMap={data.projectMap}
          ctx={data.ctx}
          hideZero={filters.hideZero}
          commentCounts={data.commentCounts}
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
          commentCounts={data.commentCounts}
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
