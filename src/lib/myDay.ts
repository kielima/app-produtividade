import { patchTask } from './taskMutations';
import type { Task } from '../types';

/** Indica se a tarefa está na lista "Meu dia". */
export function isInMyDay(task: Pick<Task, 'myDayOrder'>): boolean {
  return task.myDayOrder != null;
}

/**
 * Tarefas do "Meu dia" na ordem escolhida pelo usuário. Empates (não deveriam
 * ocorrer, mas duas abas podem adicionar no mesmo milissegundo) caem no id,
 * para a ordem não mudar de um render para o outro.
 */
export function getMyDayTasks(tasks: Task[]): Task[] {
  return tasks
    .filter(isInMyDay)
    .sort((a, b) => a.myDayOrder! - b.myDayOrder! || a.id.localeCompare(b.id));
}

/**
 * Posição de uma tarefa recém-adicionada: sempre depois das que já estão na
 * lista. Usa o relógio (e não "máximo + 1") para que adicionar não dependa de
 * ter a lista inteira em mãos — o botão vive em cards que só conhecem a
 * própria tarefa. Quem reordena renumera tudo para 0..n-1 (ver
 * `computeReorderUpdates`), que fica sempre abaixo de um timestamp.
 */
export function nextMyDayOrder(now: number = Date.now()): number {
  return now;
}

/**
 * Dada a nova ordem de ids da lista, devolve só o que precisa ser gravado:
 * cada tarefa cuja posição (índice) mudou. Renumerar para índices
 * consecutivos mantém os valores pequenos e evita ter de calcular pontos
 * médios a cada arrasto.
 */
export function computeReorderUpdates(
  orderedIds: string[],
  tasks: Task[],
): Array<{ task: Task; myDayOrder: number }> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const updates: Array<{ task: Task; myDayOrder: number }> = [];
  orderedIds.forEach((id, index) => {
    const task = byId.get(id);
    if (task && task.myDayOrder !== index) updates.push({ task, myDayOrder: index });
  });
  return updates;
}

export async function addToMyDay(uid: string, task: Task): Promise<void> {
  if (isInMyDay(task)) return;
  await patchTask(uid, task, { myDayOrder: nextMyDayOrder() });
}

export async function removeFromMyDay(uid: string, task: Task): Promise<void> {
  if (!isInMyDay(task)) return;
  await patchTask(uid, task, { myDayOrder: null });
}

export async function reorderMyDay(
  uid: string,
  orderedIds: string[],
  tasks: Task[],
): Promise<void> {
  const updates = computeReorderUpdates(orderedIds, tasks);
  await Promise.all(updates.map((u) => patchTask(uid, u.task, { myDayOrder: u.myDayOrder })));
}
