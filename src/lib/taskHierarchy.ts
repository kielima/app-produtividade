import type { Task } from '../types';

/** Filhas diretas de uma tarefa (parentId === parent.id). */
export function getChildren(parentId: string, allTasks: Task[]): Task[] {
  return allTasks.filter((t) => t.parentId === parentId);
}

/**
 * Todos os descendentes (filhas, netas, ...) de uma tarefa, em qualquer
 * profundidade. Não inclui a própria tarefa. Protegido contra ciclos.
 */
export function getDescendantIds(parentId: string, allTasks: Task[]): Set<string> {
  const out = new Set<string>();
  const queue = [parentId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const t of allTasks) {
      if (t.parentId === cur && !out.has(t.id)) {
        out.add(t.id);
        queue.push(t.id);
      }
    }
  }
  return out;
}

/**
 * Indica se `t` tem `parentId` apontando para uma tarefa que não existe mais
 * (pai apagado sem passar por `orphanChildren`). Tratamos essas tarefas como
 * de topo, já que na prática não há mais pai para agrupá-las.
 */
export function isOrphaned(t: Task, allTasks: Task[]): boolean {
  return !!t.parentId && !allTasks.some((p) => p.id === t.parentId);
}

/** Indica se a tarefa tem ao menos uma filha (direta) ainda não concluída. */
export function hasIncompleteChildren(taskId: string, allTasks: Task[]): boolean {
  return allTasks.some((t) => t.parentId === taskId && !t.checked);
}

/**
 * Indica se `t` deve ser tratada como tarefa de topo: não tem pai, ou tem
 * (`isOrphaned`). Subtarefas de um pai que ainda existe não contam.
 */
export function isTopLevel(t: Task, allTasks: Task[]): boolean {
  return !t.parentId || isOrphaned(t, allTasks);
}

/**
 * Conta tarefas de topo por projeto (`section`). Subtarefas de um pai que
 * ainda existe são ignoradas, para bater com o que a lista de Tasks exibe.
 */
export function buildTaskCountByProject(
  allTasks: Task[],
): Record<string, { total: number; done: number }> {
  const counts: Record<string, { total: number; done: number }> = {};
  for (const t of allTasks) {
    if (!isTopLevel(t, allTasks)) continue;
    const entry = counts[t.section] ?? { total: 0, done: 0 };
    entry.total += 1;
    if (t.checked) entry.done += 1;
    counts[t.section] = entry;
  }
  return counts;
}

/**
 * Mapa parentId → { total, done } das filhas diretas. Usado para mostrar
 * progresso (ex: 2/5) e para travar a conclusão de pais com filhas abertas.
 */
export function buildChildStatsMap(
  allTasks: Task[],
): Record<string, { total: number; done: number }> {
  const map: Record<string, { total: number; done: number }> = {};
  for (const t of allTasks) {
    const pid = t.parentId;
    if (!pid) continue;
    const entry = map[pid] ?? { total: 0, done: 0 };
    entry.total += 1;
    if (t.checked) entry.done += 1;
    map[pid] = entry;
  }
  return map;
}
