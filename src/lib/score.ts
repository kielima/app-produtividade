import { getDisplayTitle } from './parser';
import type { DependencyEntry, ScoreContext, Task } from '../types';

// Aceita tanto Project quanto a Section legada — só o id é usado pelo cálculo.
type ScoreSection = { id: string };

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

export function calcDeadlinePoints(deadlineStr: string, today: Date = new Date()): number {
  if (!deadlineStr) return 0;
  const t = startOfDay(today);
  const due = startOfDay(new Date(deadlineStr));
  const d = diffDays(due, t);
  if (d < 0) return 5 + Math.abs(d);
  if (d === 0) return 4;
  if (d === 1) return 3;
  if (d <= 7) return 2;
  return 1;
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
 */
export function buildDependencyMap(
  allTasks: Array<{ task: Task; section: ScoreSection | null }>,
  projectScoreMap: Record<string, number>,
  today: Date = new Date(),
): ScoreContext {
  const depMap: Record<string, DependencyEntry> = {};
  const taskFlatMap: Record<string, Task> = {};
  const taskIdMap: Record<number, Task> = {};
  const potentialScoreMap: Record<string, number> = {};

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

  const t0 = startOfDay(today);
  for (const { task: t, section: s } of allTasks) {
    const taskM = t.moscow || '';
    if (taskM === 'wont') {
      potentialScoreMap[t.id] = 0;
      continue;
    }
    const projectScore = s ? projectScoreMap[s.id] ?? 0 : 0;
    const base = projectScore * (TASK_MOSCOW_PTS[taskM] ?? 1);
    const inProgressBonus = t.inProgress ? 1 : 0;
    let deadlineBonus = 0;
    if (t.deadline) {
      const due = startOfDay(new Date(t.deadline));
      const diff = diffDays(due, t0);
      if (diff < 0) deadlineBonus = 5 + Math.abs(diff);
      else if (diff === 0) deadlineBonus = 4;
      else if (diff === 1) deadlineBonus = 3;
      else if (diff <= 7) deadlineBonus = 2;
      else deadlineBonus = 1;
    }
    let ageBonus = 0;
    if (t.addedDate) {
      const added = startOfDay(new Date(t.addedDate));
      const dias = Math.max(0, diffDays(t0, added));
      ageBonus = Math.log2(dias + 1);
    }
    const effort = EFFORT_DIV[t.esforco || ''] ?? 1;
    potentialScoreMap[t.id] = (base + inProgressBonus + deadlineBonus + ageBonus) / effort;
  }

  return { depMap, potentialScoreMap, taskFlatMap, projectScoreMap };
}

/**
 * Calcula o score de uma tarefa. Bloqueada → 0. Wont → 0.
 * Mesma fórmula do `calcScore()` do dashboard.html.
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
  const depBonus = dep.unlocksIds.reduce((sum, id) => sum + (ctx.potentialScoreMap[id] ?? 0), 0);
  const deadlineBonus = calcDeadlinePoints(task.deadline, today);
  const inProgressBonus = task.inProgress ? 1 : 0;

  let ageBonus = 0;
  if (task.addedDate) {
    const added = startOfDay(new Date(task.addedDate));
    const t0 = startOfDay(today);
    const dias = Math.max(0, diffDays(t0, added));
    ageBonus = Math.log2(dias + 1);
  }

  const effort = EFFORT_DIV[task.esforco || ''] ?? 1;
  return (base + depBonus + inProgressBonus + deadlineBonus + ageBonus) / effort;
}

export function isTaskBlocked(task: Task, ctx: ScoreContext): boolean {
  const dep = ctx.depMap[task.id];
  if (!dep) return false;
  return dep.blockedByIds.some((id) => ctx.taskFlatMap[id] && !ctx.taskFlatMap[id]!.checked);
}
