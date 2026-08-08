import { describe, expect, it } from 'vitest';
import {
  buildGanttData,
  computeGanttEdges,
  GANTT_NO_PROJECT_ID,
  ganttMonthTicks,
  ganttPositionPct,
} from './gantt';
import type { GanttGroup } from './gantt';
import type { Project, ScoreContext, Task } from '../types';

function task(overrides: Partial<Task>): Task {
  return {
    id: 'id',
    taskId: 1,
    title: 'Tarefa',
    note: '',
    checked: false,
    inProgress: false,
    moscow: 'should',
    modo: 'chat',
    esforco: 'medio',
    deadline: '',
    addedDate: '',
    dependsOn: [],
    subtasks: [],
    section: '',
    completedAt: null,
    ...overrides,
  };
}

function emptyCtx(): ScoreContext {
  return {
    depMap: {},
    potentialScoreMap: {},
    taskFlatMap: {},
    projectScoreMap: {},
    transitiveUnlocksMap: {},
    maxOverdueScore: 0,
  };
}

const project: Record<string, Project> = {
  proj1: {
    id: 'proj1',
    name: 'Projeto Um',
    area: '',
    categories: [],
    status: 'Em andamento',
    priority: '',
    moscow: '',
    objective: '',
    currentStatus: '',
    nextSteps: '',
    deadline: '',
    estimatedDuration: '',
    dependsOn: null,
    notes: '',
  },
};

describe('buildGanttData', () => {
  it('vira barra quando tem addedDate e deadline', () => {
    const t = task({
      id: 'a',
      title: 'Fazer X',
      addedDate: '2026-01-01',
      deadline: '2026-01-10',
      section: 'proj1',
    });
    const data = buildGanttData([t], project, emptyCtx(), new Date('2026-01-15'));
    expect(data.unscheduledCount).toBe(0);
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]!.projectName).toBe('Projeto Um');
    const bar = data.groups[0]!.bars[0]!;
    expect(bar.displayTitle).toBe('Fazer X');
    expect(bar.isMilestone).toBe(false);
    expect(bar.openEnded).toBe(false);
    expect(bar.start.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(bar.end.toISOString().slice(0, 10)).toBe('2026-01-10');
  });

  it('vira marco quando só tem deadline', () => {
    const t = task({ id: 'b', deadline: '2026-02-01' });
    const data = buildGanttData([t], project, emptyCtx());
    const bar = data.groups[0]!.bars[0]!;
    expect(bar.isMilestone).toBe(true);
    expect(bar.start.getTime()).toBe(bar.end.getTime());
  });

  it('vira barra aberta até hoje quando só tem addedDate e não está concluída', () => {
    const t = task({ id: 'c', addedDate: '2026-01-01' });
    const today = new Date('2026-01-20');
    const data = buildGanttData([t], project, emptyCtx(), today);
    const bar = data.groups[0]!.bars[0]!;
    expect(bar.openEnded).toBe(true);
    expect(bar.end.getTime()).toBe(today.getTime());
  });

  it('fecha a barra aberta no addedDate se a tarefa já foi concluída', () => {
    const t = task({ id: 'd', addedDate: '2026-01-01', checked: true });
    const data = buildGanttData([t], project, emptyCtx(), new Date('2026-01-20'));
    const bar = data.groups[0]!.bars[0]!;
    expect(bar.openEnded).toBe(false);
    expect(bar.end.getTime()).toBe(bar.start.getTime());
  });

  it('conta como sem-agenda quando não tem nenhuma data', () => {
    const t = task({ id: 'e' });
    const data = buildGanttData([t], project, emptyCtx());
    expect(data.unscheduledCount).toBe(1);
    expect(data.groups).toHaveLength(0);
  });

  it('agrupa tarefas sem projeto à parte, no fim da lista', () => {
    const withProject = task({ id: 'f', addedDate: '2026-01-01', deadline: '2026-01-02', section: 'proj1' });
    const withoutProject = task({ id: 'g', addedDate: '2026-01-01', deadline: '2026-01-02', section: '' });
    const data = buildGanttData([withProject, withoutProject], project, emptyCtx());
    expect(data.groups).toHaveLength(2);
    expect(data.groups[0]!.projectId).toBe('proj1');
    expect(data.groups[1]!.projectId).toBe(GANTT_NO_PROJECT_ID);
  });

  it('marca blocked usando isTaskBlocked do ctx', () => {
    const blocker = task({ id: 'blocker', checked: false });
    const blocked = task({ id: 'blocked', addedDate: '2026-01-01', deadline: '2026-01-05' });
    const ctx: ScoreContext = {
      ...emptyCtx(),
      depMap: { blocked: { blockedByIds: ['blocker'], unlocksIds: [] } },
      taskFlatMap: { blocker },
    };
    const data = buildGanttData([blocked], project, ctx);
    expect(data.groups[0]!.bars[0]!.blocked).toBe(true);
  });
});

describe('ganttPositionPct', () => {
  it('calcula a posição percentual dentro do range', () => {
    const start = new Date('2026-01-01');
    const end = new Date('2026-01-11');
    const mid = new Date('2026-01-06');
    expect(ganttPositionPct(mid, start, end)).toBe(50);
    expect(ganttPositionPct(start, start, end)).toBe(0);
    expect(ganttPositionPct(end, start, end)).toBe(100);
  });

  it('mantém dentro de [0,100] mesmo fora do range', () => {
    const start = new Date('2026-01-01');
    const end = new Date('2026-01-11');
    expect(ganttPositionPct(new Date('2025-12-01'), start, end)).toBe(0);
    expect(ganttPositionPct(new Date('2026-02-01'), start, end)).toBe(100);
  });

  it('devolve 0 quando o range tem duração zero', () => {
    const d = new Date('2026-01-01');
    expect(ganttPositionPct(d, d, d)).toBe(0);
  });
});

describe('ganttMonthTicks', () => {
  it('gera uma marca por início de mês dentro do range', () => {
    const ticks = ganttMonthTicks(new Date('2026-01-15'), new Date('2026-03-10'));
    expect(ticks.map((t) => t.label)).toEqual(['fev/26', 'mar/26']);
  });

  it('inclui o próprio início do range se ele já cair no dia 1', () => {
    const ticks = ganttMonthTicks(new Date('2026-01-01'), new Date('2026-01-31'));
    expect(ticks.map((t) => t.label)).toEqual(['jan/26']);
  });

  it('devolve lista vazia quando o range é inválido (fim <= início)', () => {
    const d = new Date('2026-01-01');
    expect(ganttMonthTicks(d, d)).toEqual([]);
  });
});

function bar(overrides: Partial<import('./gantt').GanttBar>): import('./gantt').GanttBar {
  return {
    taskId: 'x',
    displayTitle: 'X',
    start: new Date('2026-01-01'),
    end: new Date('2026-01-02'),
    isMilestone: false,
    openEnded: false,
    checked: false,
    moscow: 'should',
    blocked: false,
    ...overrides,
  };
}

describe('computeGanttEdges', () => {
  it('cria uma aresta quando bloqueadora e bloqueada estão visíveis', () => {
    const groups: GanttGroup[] = [
      { projectId: 'p', projectName: 'P', bars: [bar({ taskId: 'a' }), bar({ taskId: 'b' })] },
    ];
    const ctx = emptyCtx();
    ctx.depMap = { b: { blockedByIds: ['a'], unlocksIds: [] } };
    const edges = computeGanttEdges(groups, ctx);
    expect(edges).toEqual([{ fromId: 'a', toId: 'b', resolved: false }]);
  });

  it('marca resolved=true quando a bloqueadora já está concluída', () => {
    const groups: GanttGroup[] = [
      {
        projectId: 'p',
        projectName: 'P',
        bars: [bar({ taskId: 'a', checked: true }), bar({ taskId: 'b' })],
      },
    ];
    const ctx = emptyCtx();
    ctx.depMap = { b: { blockedByIds: ['a'], unlocksIds: [] } };
    const edges = computeGanttEdges(groups, ctx);
    expect(edges[0]!.resolved).toBe(true);
  });

  it('omite a aresta quando a bloqueadora não está visível no Gantt (sem data)', () => {
    const groups: GanttGroup[] = [
      { projectId: 'p', projectName: 'P', bars: [bar({ taskId: 'b' })] },
    ];
    const ctx = emptyCtx();
    ctx.depMap = { b: { blockedByIds: ['a'], unlocksIds: [] } };
    expect(computeGanttEdges(groups, ctx)).toEqual([]);
  });

  it('não duplica aresta se a mesma dependência aparecer mais de uma vez', () => {
    const groups: GanttGroup[] = [
      { projectId: 'p', projectName: 'P', bars: [bar({ taskId: 'a' }), bar({ taskId: 'b' })] },
    ];
    const ctx = emptyCtx();
    ctx.depMap = { b: { blockedByIds: ['a', 'a'], unlocksIds: [] } };
    expect(computeGanttEdges(groups, ctx)).toHaveLength(1);
  });
});
