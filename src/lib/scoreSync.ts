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

function docIdOf(task: Task): string {
  return task.taskId != null ? String(task.taskId) : task.id;
}

/**
 * Compara o score já salvo em cada tarefa (`task.score`/`task.scoreBreakdown`,
 * espelho do Supabase) com o que `calcScoreBreakdown` produz agora, e devolve
 * só as tarefas cujo valor mudou. Usada por `useUserData` para manter a
 * coluna `score` do Supabase atualizada — ver `updateTaskScore` em
 * `src/repositories/tasksRepo.ts`.
 */
export function computeScoreUpdates(
  tasks: ReadonlyArray<Task>,
  projectMap: Record<string, Project>,
  ctx: ScoreContext,
  today: Date = new Date(),
): ScoreUpdate[] {
  const out: ScoreUpdate[] = [];
  for (const task of tasks) {
    const section = projectMap[task.section] ?? null;
    const breakdown = calcScoreBreakdown(task, section, ctx, today);
    const score = round(breakdown.total);
    const prevScore = task.score != null ? round(task.score) : null;
    if (prevScore === score && JSON.stringify(task.scoreBreakdown ?? null) === JSON.stringify(breakdown)) {
      continue;
    }
    out.push({ docId: docIdOf(task), score, breakdown });
  }
  return out;
}
