import { getDisplayTitle } from './parser';
import type { DependencyEntry, ScoreContext, Task } from '../types';

// Aceita tanto Project quanto a Section legada — id é obrigatório, deadline
// é opcional (só Project tem; usado pelo bônus de prazo do projeto).
type ScoreSection = { id: string; deadline?: string };

const TASK_MOSCOW_PTS: Record<string, number> = {
  must: 3,
  should: 2,
  could: 1,
  wont: 0,
  '': 1,
};

const EFFORT_DIV: Record<string, number> = {
  rapido: 1,
  medio: 2,
  longo: 3,
  '': 1,
};

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function diffDays(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

/**
 * Pontos da componente de prazo da tarefa.
 *   - sem prazo: 0
 *   - atrasada: 5 + |dias_atraso|  (mantido como antes)
 *   - upcoming: max(0, maxOverdueScore + 10 - dias_até_vencer)
 *
 * O `maxOverdueScore` é o score total da tarefa mais atrasada do contexto.
 * Default 0 mantém a função utilizável fora do contexto (e em testes simples).
 */
export function calcDeadlinePoints(
  deadlineStr: string,
  today: Date = new Date(),
  maxOverdueScore: number = 0,
): number {
  if (!deadlineStr) return 0;
  const t = startOfDay(today);
  const due = startOfDay(new Date(deadlineStr));
  const d = diffDays(due, t);
  if (d < 0) return 5 + Math.abs(d);
  return Math.max(0, maxOverdueScore + 10 - d);
}

/**
 * Bônus de prazo do projeto, somado a cada tarefa do projeto. Mesma ideia
 * do bônus da tarefa, mas sem o offset do `maxOverdueScore` — só conta
 * pressão futura. Projetos já atrasados não contribuem.
 */
export function calcProjectDeadlinePoints(
  deadlineStr: string | undefined,
  today: Date = new Date(),
): number {
  if (!deadlineStr) return 0;
  const t = startOfDay(today);
  const due = startOfDay(new Date(deadlineStr));
  const d = diffDays(due, t);
  if (d < 0) return 0;
  return Math.max(0, 10 - d);
}

function depTitleTokens(title: string): string[] {
  return getDisplayTitle(title)
    .toLowerCase()
    .split(/[\s()\[\],;:/\-+*&]+/)
    .filter(Boolean);
}

function depWordMatch(title: string, needle: string): boolean {
  return depTitleTokens(title).some((w) => w === needle);
}

/**
 * Constrói o grafo de dependências entre tarefas e o score "potencial"
 * (usado pelo bônus de desbloqueio). Equivalente ao `buildDependencyMap()`
 * do dashboard.html, mas puro (não usa globais).
 *
 * Internamente faz três passes:
 *   1. Computa potencial assumindo maxOverdueScore = 0.
 *   2. Encontra a tarefa mais atrasada (maior |dias_atraso|) e calcula seu
 *      score total → maxOverdueScore.
 *   3. Recomputa potencial com o maxOverdueScore real, para que tarefas
 *      upcoming destravadas reflitam o boost no depBonus.
 */
export function buildDependencyMap(
  allTasks: Array<{ task: Task; section: ScoreSection | null }>,
  projectScoreMap: Record<string, number>,
  today: Date = new Date(),
): ScoreContext {
  const depMap: Record<string, DependencyEntry> = {};
  const taskFlatMap: Record<string, Task> = {};
  const taskIdMap: Record<number, Task> = {};

  for (const { task: t } of allTasks) {
    depMap[t.id] = { blockedByIds: [], unlocksIds: [] };
    taskFlatMap[t.id] = t;
    if (t.taskId != null) taskIdMap[t.taskId] = t;
  }

  for (const { task: t } of allTasks) {
    if (!t.dependsOn || t.dependsOn.length === 0) continue;
    for (const depText of t.dependsOn) {
      let depTask: Task | undefined;
      const idMatch = depText.trim().match(/^#(\d+)$/);
      if (idMatch) {
        depTask = taskIdMap[parseInt(idMatch[1]!, 10)];
      } else {
        const needle = depText.toLowerCase().trim();
        depTask =
          allTasks.find((x) => x.task.id !== t.id && depWordMatch(x.task.title, needle))?.task ??
          allTasks.find(
            (x) =>
              x.task.id !== t.id && getDisplayTitle(x.task.title).toLowerCase().includes(needle),
          )?.task;
      }
      if (depTask) {
        const entry = depMap[t.id]!;
        if (!entry.blockedByIds.includes(depTask.id)) entry.blockedByIds.push(depTask.id);
        if (!depMap[depTask.id]) depMap[depTask.id] = { blockedByIds: [], unlocksIds: [] };
        if (!depMap[depTask.id]!.unlocksIds.includes(t.id))
          depMap[depTask.id]!.unlocksIds.push(t.id);
      }
    }
  }

  const transitiveUnlocksMap: Record<string, string[]> = {};
  for (const rootId of Object.keys(depMap)) {
    const reached = new Set<string>();
    const queue: string[] = [...(depMap[rootId]?.unlocksIds ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (next === rootId || reached.has(next)) continue;
      reached.add(next);
      for (const child of depMap[next]?.unlocksIds ?? []) {
        if (child !== rootId && !reached.has(child)) queue.push(child);
      }
    }
    transitiveUnlocksMap[rootId] = [...reached];
  }

  const t0 = startOfDay(today);

  function computePotentialMap(maxOverdueScore: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const { task: t, section: s } of allTasks) {
      const taskM = t.moscow || '';
      if (taskM === 'wont') {
        out[t.id] = 0;
        continue;
      }
      const projectScore = s ? projectScoreMap[s.id] ?? 0 : 0;
      const base = projectScore * (TASK_MOSCOW_PTS[taskM] ?? 1);
      const effort = EFFORT_DIV[t.esforco || ''] ?? 1;
      const inProgressBonus = t.inProgress ? 1 : 0;
      const deadlineBonus = calcDeadlinePoints(t.deadline, today, maxOverdueScore);
      const projectDeadlineBonus = calcProjectDeadlinePoints(s?.deadline, today);
      let ageBonus = 0;
      if (t.addedDate) {
        const added = startOfDay(new Date(t.addedDate));
        const dias = Math.max(0, diffDays(t0, added));
        ageBonus = Math.log2(dias + 1);
      }
      out[t.id] =
        base / effort + inProgressBonus + deadlineBonus + ageBonus + projectDeadlineBonus;
    }
    return out;
  }

  // Pass 1: potencial inicial assumindo maxOverdueScore = 0.
  let potentialScoreMap = computePotentialMap(0);

  // Pass 2: descobrir score da tarefa mais atrasada (por dias).
  let maxOverdueDays = -1;
  let maxOverdueScore = 0;
  const tempCtx: ScoreContext = {
    depMap,
    potentialScoreMap,
    taskFlatMap,
    projectScoreMap,
    transitiveUnlocksMap,
    maxOverdueScore: 0,
  };
  for (const { task: t, section: s } of allTasks) {
    if (!t.deadline || t.checked) continue;
    const due = startOfDay(new Date(t.deadline));
    const d = diffDays(due, t0);
    if (d >= 0) continue;
    const daysLate = Math.abs(d);
    if (daysLate < maxOverdueDays) continue;
    const score = calcScore(t, s, tempCtx, today);
    if (daysLate > maxOverdueDays) {
      maxOverdueDays = daysLate;
      maxOverdueScore = score;
    } else if (score > maxOverdueScore) {
      maxOverdueScore = score;
    }
  }

  // Pass 3: recomputa potencial com o maxOverdueScore real.
  potentialScoreMap = computePotentialMap(maxOverdueScore);

  return {
    depMap,
    potentialScoreMap,
    taskFlatMap,
    projectScoreMap,
    transitiveUnlocksMap,
    maxOverdueScore,
  };
}

/**
 * Calcula o score de uma tarefa. Bloqueada → 0. Wont → 0.
 *
 * Fórmula:
 *   score = (base / effort) + depBonus + inProgressBonus + deadlineBonus
 *         + ageBonus + projectDeadlineBonus
 *
 * Diferente da versão anterior, apenas o `base` é dividido pelo esforço —
 * os bônus contribuem em valor absoluto.
 */
export function calcScore(
  task: Task,
  section: ScoreSection | null,
  ctx: ScoreContext,
  today: Date = new Date(),
): number {
  const dep = ctx.depMap[task.id] ?? { blockedByIds: [], unlocksIds: [] };
  const activeBlockers = dep.blockedByIds.filter(
    (id) => ctx.taskFlatMap[id] && !ctx.taskFlatMap[id]!.checked,
  );
  if (activeBlockers.length > 0) return 0;

  const taskM = task.moscow || '';
  if (taskM === 'wont') return 0;

  const projectScore = section ? ctx.projectScoreMap[section.id] ?? 0 : 0;
  const base = projectScore * (TASK_MOSCOW_PTS[taskM] ?? 1);
  const unlockedChain = ctx.transitiveUnlocksMap[task.id] ?? dep.unlocksIds;
  const depBonus = unlockedChain.reduce((sum, id) => sum + (ctx.potentialScoreMap[id] ?? 0), 0);
  const deadlineBonus = calcDeadlinePoints(task.deadline, today, ctx.maxOverdueScore);
  const projectDeadlineBonus = calcProjectDeadlinePoints(section?.deadline, today);
  const inProgressBonus = task.inProgress ? 1 : 0;

  let ageBonus = 0;
  if (task.addedDate) {
    const added = startOfDay(new Date(task.addedDate));
    const t0 = startOfDay(today);
    const dias = Math.max(0, diffDays(t0, added));
    ageBonus = Math.log2(dias + 1);
  }

  const effort = EFFORT_DIV[task.esforco || ''] ?? 1;
  return (
    base / effort + depBonus + inProgressBonus + deadlineBonus + ageBonus + projectDeadlineBonus
  );
}

export function isTaskBlocked(task: Task, ctx: ScoreContext): boolean {
  const dep = ctx.depMap[task.id];
  if (!dep) return false;
  return dep.blockedByIds.some((id) => ctx.taskFlatMap[id] && !ctx.taskFlatMap[id]!.checked);
}
