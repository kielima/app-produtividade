import { supabase } from '../lib/supabase';
import { normalizeEsforco, normalizeModo, normalizeMoscow } from '../lib/taskFields';
import { publishLocalRow, subscribeTable, type Unsubscribe } from './realtimeTable';
import type { Task } from '../types';

interface TaskRow {
  id: string;
  user_id: string;
  task_id: number | null;
  title: string;
  note: string | null;
  checked: boolean;
  in_progress: boolean;
  moscow: string | null;
  modo: string | null;
  esforco: string | null;
  deadline: string | null;
  added_date: string | null;
  depends_on: string[] | null;
  parent_id: string | null;
  order: number | null;
  project_id: string | null;
  completed_at: string | null;
  completed_from_section_name: string | null;
  snoozed_until: string | null;
  source_item_id: string | null;
  source_annotation_id: string | null;
  tags: string[] | null;
}

// As colunas `moscow`/`modo`/`esforco` são `text` livre e guardam também
// rótulos de versões anteriores do app (ex.: `modo = 'colaborar'`, de antes
// da troca das tags de Modo). Sem normalizar aqui, um valor fora da união
// entraria no estado do app com o cast do TypeScript por cima e derrubaria
// quem o usa como chave de `Record` — era o que apagava a tela inteira ao
// abrir Estatísticas. Ver src/lib/taskFields.ts.
export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    note: row.note ?? '',
    checked: row.checked,
    inProgress: row.in_progress,
    moscow: normalizeMoscow(row.moscow),
    modo: normalizeModo(row.modo),
    esforco: normalizeEsforco(row.esforco),
    deadline: row.deadline ?? '',
    addedDate: row.added_date ?? '',
    dependsOn: row.depends_on ?? [],
    parentId: row.parent_id ?? null,
    order: row.order ?? null,
    section: row.project_id ?? '',
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    completedFromSectionName: row.completed_from_section_name ?? null,
    snoozedUntil: row.snoozed_until ?? null,
    ...(row.source_item_id != null ? { sourceItemId: row.source_item_id } : {}),
    ...(row.source_annotation_id != null ? { sourceAnnotationId: row.source_annotation_id } : {}),
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

function taskDocId(task: Pick<Task, 'taskId' | 'id'>): string {
  return task.taskId != null ? String(task.taskId) : task.id;
}

export function taskToRow(uid: string, task: Task): Omit<TaskRow, 'user_id'> & { user_id: string } {
  return {
    id: taskDocId(task),
    user_id: uid,
    task_id: task.taskId,
    title: task.title,
    note: task.note,
    checked: task.checked,
    in_progress: task.inProgress,
    moscow: task.moscow,
    modo: task.modo,
    esforco: task.esforco,
    deadline: task.deadline,
    added_date: task.addedDate,
    depends_on: task.dependsOn,
    parent_id: task.parentId ?? null,
    order: task.order ?? null,
    project_id: task.section || null,
    completed_at: task.completedAt ? task.completedAt.toISOString() : null,
    completed_from_section_name: task.completedFromSectionName ?? null,
    snoozed_until: task.snoozedUntil ?? null,
    source_item_id: task.sourceItemId ?? null,
    source_annotation_id: task.sourceAnnotationId ?? null,
    tags: task.tags,
  };
}

export function subscribeToTasks(
  uid: string,
  cb: (tasks: Task[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<TaskRow, Task>(
    { table: 'tasks', uid, mapRow: rowToTask, idOf: (t) => t.id, onError },
    cb,
  );
}

export async function upsertTask(uid: string, task: Task): Promise<void> {
  const row = taskToRow(uid, task);
  const { error } = await supabase.from('tasks').upsert(row);
  if (error) throw new Error(error.message);
  // A tarefa passa a existir no estado local assim que a gravação confirma,
  // sem esperar o INSERT/UPDATE do Realtime. É isto que permite criar uma
  // tarefa e abrir a tela dela em seguida: quem navega logo após o await
  // encontra a tarefa na lista (ver `publishLocalRow`).
  publishLocalRow('tasks', uid, row);
}

export async function deleteTask(uid: string, task: Pick<Task, 'taskId' | 'id'>): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('user_id', uid)
    .eq('id', taskDocId(task));
  if (error) throw new Error(error.message);
}

/**
 * Marca/desmarca uma tarefa como concluída. Ao marcar, grava o timestamp
 * de conclusão (`completedAt`) e um snapshot do nome do projeto naquele
 * momento (`completedFromSectionName`) — para que as estatísticas
 * continuem mostrando o nome mesmo se o projeto for deletado depois. Ao
 * desmarcar, ambos voltam a null.
 */
export async function setTaskCompleted(
  uid: string,
  task: Task,
  completed: boolean,
): Promise<void> {
  const id = taskDocId(task);
  if (completed) {
    let projectName: string | null = null;
    if (task.section) {
      const { data } = await supabase
        .from('projects')
        .select('name')
        .eq('user_id', uid)
        .eq('id', task.section)
        .maybeSingle();
      projectName = (data?.name as string | undefined) ?? null;
    }
    const { error } = await supabase
      .from('tasks')
      .update({
        checked: true,
        completed_at: new Date().toISOString(),
        completed_from_section_name: projectName,
      })
      .eq('user_id', uid)
      .eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('tasks')
      .update({ checked: false, completed_at: null, completed_from_section_name: null })
      .eq('user_id', uid)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}

/**
 * Atribui o próximo `taskId` (max+1 entre as tarefas do usuário) ao criar
 * uma nova tarefa.
 */
export async function nextTaskId(uid: string): Promise<number> {
  const { data, error } = await supabase
    .from('tasks')
    .select('task_id')
    .eq('user_id', uid)
    .order('task_id', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const max = (data?.[0]?.task_id as number | null | undefined) ?? 0;
  return max + 1;
}
