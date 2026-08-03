import { getDisplayTitle } from './parser';
import { isTaskBlocked } from './score';
import type { MoSCoW, Project, ScoreContext, Task } from '../types';

export interface GanttBar {
  taskId: string;
  displayTitle: string;
  start: Date;
  end: Date;
  // Sem data de início (só prazo): desenhado como marco (losango), não barra.
  isMilestone: boolean;
  // Tem data de início mas não prazo: barra "aberta" (sem previsão de fim).
  openEnded: boolean;
  checked: boolean;
  moscow: MoSCoW;
  blocked: boolean;
}

export interface GanttGroup {
  projectId: string;
  projectName: string;
  bars: GanttBar[];
}

export interface GanttData {
  rangeStart: Date;
  rangeEnd: Date;
  groups: GanttGroup[];
  // Tarefas sem addedDate nem deadline — não dá pra posicionar na linha do
  // tempo, ficam de fora dos grupos e só são contadas aqui.
  unscheduledCount: number;
}

export const GANTT_NO_PROJECT_ID = '__sem_projeto';
const NO_PROJECT_NAME = 'Sem projeto';
const RANGE_PAD_MS = 86400000; // 1 dia de respiro em cada ponta do range

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Constrói os dados do Gantt a partir das tarefas (já filtradas pela tela de
 * Tasks) agrupadas por projeto. Uma tarefa vira:
 *   - barra (addedDate → deadline), se tiver as duas datas;
 *   - marco/losango, se só tiver deadline;
 *   - barra aberta (addedDate → hoje, ou até o próprio addedDate se já
 *     concluída), se só tiver addedDate;
 *   - nenhuma das anteriores: fica de fora, contada em `unscheduledCount`.
 */
export function buildGanttData(
  tasks: Task[],
  projectMap: Record<string, Project>,
  ctx: ScoreContext,
  today: Date = new Date(),
): GanttData {
  const groupsMap = new Map<string, GanttGroup>();
  let unscheduledCount = 0;
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;

  function extend(d: Date) {
    if (!rangeStart || d < rangeStart) rangeStart = d;
    if (!rangeEnd || d > rangeEnd) rangeEnd = d;
  }

  for (const t of tasks) {
    const added = parseDate(t.addedDate);
    const deadline = parseDate(t.deadline);

    let bar: GanttBar;
    if (added && deadline) {
      bar = {
        taskId: t.id,
        displayTitle: getDisplayTitle(t.title),
        start: added,
        end: deadline < added ? added : deadline,
        isMilestone: false,
        openEnded: false,
        checked: t.checked,
        moscow: t.moscow,
        blocked: isTaskBlocked(t, ctx),
      };
    } else if (deadline) {
      bar = {
        taskId: t.id,
        displayTitle: getDisplayTitle(t.title),
        start: deadline,
        end: deadline,
        isMilestone: true,
        openEnded: false,
        checked: t.checked,
        moscow: t.moscow,
        blocked: isTaskBlocked(t, ctx),
      };
    } else if (added) {
      const openEnd = t.checked ? added : today;
      bar = {
        taskId: t.id,
        displayTitle: getDisplayTitle(t.title),
        start: added,
        end: openEnd < added ? added : openEnd,
        isMilestone: false,
        openEnded: !t.checked,
        checked: t.checked,
        moscow: t.moscow,
        blocked: isTaskBlocked(t, ctx),
      };
    } else {
      unscheduledCount++;
      continue;
    }

    extend(bar.start);
    extend(bar.end);

    const projectId = t.section || GANTT_NO_PROJECT_ID;
    const projectName = projectMap[t.section]?.name ?? NO_PROJECT_NAME;
    let group = groupsMap.get(projectId);
    if (!group) {
      group = { projectId, projectName, bars: [] };
      groupsMap.set(projectId, group);
    }
    group.bars.push(bar);
  }

  for (const group of groupsMap.values()) {
    group.bars.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  const groups = [...groupsMap.values()].sort((a, b) => {
    if (a.projectId === GANTT_NO_PROJECT_ID) return 1;
    if (b.projectId === GANTT_NO_PROJECT_ID) return -1;
    return a.projectName.localeCompare(b.projectName, 'pt-BR');
  });

  const start = rangeStart ?? today;
  const end = rangeEnd ?? today;
  return {
    rangeStart: new Date(start.getTime() - RANGE_PAD_MS),
    rangeEnd: new Date(end.getTime() + RANGE_PAD_MS),
    groups,
    unscheduledCount,
  };
}

/** Posição (0–100) de uma data dentro do range do Gantt, em percentual. */
export function ganttPositionPct(date: Date, rangeStart: Date, rangeEnd: Date): number {
  const span = rangeEnd.getTime() - rangeStart.getTime();
  if (span <= 0) return 0;
  const pct = ((date.getTime() - rangeStart.getTime()) / span) * 100;
  return Math.min(100, Math.max(0, pct));
}

export interface GanttTick {
  date: Date;
  pct: number;
  label: string;
}

const MONTH_LABEL = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** Marcas de início de mês dentro do range, pra desenhar a régua do Gantt. */
export function ganttMonthTicks(rangeStart: Date, rangeEnd: Date): GanttTick[] {
  if (rangeEnd.getTime() <= rangeStart.getTime()) return [];
  const ticks: GanttTick[] = [];
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor.getTime() <= rangeEnd.getTime()) {
    if (cursor.getTime() >= rangeStart.getTime()) {
      ticks.push({
        date: new Date(cursor),
        pct: ganttPositionPct(cursor, rangeStart, rangeEnd),
        label: `${MONTH_LABEL[cursor.getMonth()]}/${String(cursor.getFullYear()).slice(2)}`,
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}
