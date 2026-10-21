import { calcScoreBreakdown, type ScoreBreakdown } from './score';
import type { Project, ScoreContext, Task } from '../types';

export interface ScoreUpdate {
  docId: string;
  score: number;
  breakdown: ScoreBreakdown;
}

// Arredonda antes de comparar/gravar — evita reescrever a cada recomputo só
// por ruído de ponto flutuante (ex.: 2.9999999999999996 vs 3).
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// Serializa com as chaves ordenadas. O Postgres devolve `jsonb` com as chaves
// reordenadas (por tamanho e depois alfabeticamente), então comparar
// `JSON.stringify` cru do salvo com o recém-calculado dava sempre diferente —
// toda tarefa era regravada a cada recomputo, cada gravação voltava pelo
// Realtime e disparava outro recomputo, num ciclo sem fim.
export function stableStringify(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
    return sorted;
  });
}

function docIdOf(task: Task): string {
  return task.taskId != null ? String(task.taskId) : task.id;
}

/**
 * Compara o score já salvo em cada tarefa (`task.score`/`task.scoreBreakdown`,
 * espelho do Supabase) com o que `calcScoreBreakdown` produz agora, e devolve
 * só as tarefas cujo valor mudou. Usada por `useUserData` para manter a
 * coluna `score` do Supabase atualizada — ver `updateTaskScores` em
 * `src/repositories/tasksRepo.ts`. Tarefas concluídas ficam de fora: o score
 * só interessa para o que ainda está por fazer.
 */
export function computeScoreUpdates(
  tasks: ReadonlyArray<Task>,
  projectMap: Record<string, Project>,
  ctx: ScoreContext,
  today: Date = new Date(),
): ScoreUpdate[] {
  const out: ScoreUpdate[] = [];
  for (const task of tasks) {
    if (task.checked) continue;
    const section = projectMap[task.section] ?? null;
    const breakdown = calcScoreBreakdown(task, section, ctx, today);
    const score = round(breakdown.total);
    const prevScore = task.score != null ? round(task.score) : null;
    if (prevScore === score && stableStringify(task.scoreBreakdown) === stableStringify(breakdown)) {
      continue;
    }
    out.push({ docId: docIdOf(task), score, breakdown });
  }
  return out;
}
