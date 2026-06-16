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

/** Indica se a tarefa tem ao menos uma filha (direta) ainda não concluída. */
export function hasIncompleteChildren(taskId: string, allTasks: Task[]): boolean {
  return allTasks.some((t) => t.parentId === taskId && !t.checked);
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
