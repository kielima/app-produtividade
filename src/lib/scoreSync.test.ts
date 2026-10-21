import { describe, expect, it } from 'vitest';
import { buildProjectScoreMap } from './projectRankScore';
import { buildDependencyMap } from './score';
import { computeScoreUpdates } from './scoreSync';
import type { Project, Task } from '../types';

const TODAY = new Date('2026-05-15T12:00:00');

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? '1',
    taskId: overrides.taskId ?? 1,
    title: 'X',
    note: '',
    checked: false,
    inProgress: false,
    moscow: '',
    modo: 'manual',
    esforco: '',
    deadline: '',
    addedDate: '',
    dependsOn: [],
    section: 's',
    completedAt: null,
    tags: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: overrides.id,
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
    ...overrides,
  };
}

function ctxFor(tasks: Task[], projects: Project[]) {
  const projectMap: Record<string, Project> = {};
  for (const p of projects) projectMap[p.id] = p;
  const projectScoreMap = buildProjectScoreMap(projects, tasks);
  const ctx = buildDependencyMap(
    tasks.map((task) => ({ task, section: projectMap[task.section] ?? null })),
    projectScoreMap,
    TODAY,
  );
  return { ctx, projectMap };
}

describe('computeScoreUpdates', () => {
  it('reports every task on first run (nenhum score salvo ainda)', () => {
    const project = makeProject({ id: 's' });
    const task = makeTask();
    const { ctx, projectMap } = ctxFor([task], [project]);

    const updates = computeScoreUpdates([task], projectMap, ctx, TODAY);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.docId).toBe('1');
    expect(updates[0]!.score).toBeGreaterThan(0);
    expect(updates[0]!.breakdown.total).toBe(updates[0]!.score);
  });

  it('não repete tarefa cujo score/breakdown já bate com o salvo', () => {
    const project = makeProject({ id: 's' });
    const task = makeTask();
    const { ctx, projectMap } = ctxFor([task], [project]);

    const [first] = computeScoreUpdates([task], projectMap, ctx, TODAY);
    const taskWithScore: Task = {
      ...task,
      score: first!.score,
      scoreBreakdown: first!.breakdown as unknown as Record<string, unknown>,
    };

    const updates = computeScoreUpdates([taskWithScore], projectMap, ctx, TODAY);
    expect(updates).toHaveLength(0);
  });

  it('não repete quando o breakdown volta do banco com as chaves em outra ordem', () => {
    // O Postgres (jsonb) devolve as chaves reordenadas; sem comparar de forma
    // independente da ordem, toda tarefa era regravada em laço infinito.
    const project = makeProject({ id: 's' });
    const task = makeTask();
    const { ctx, projectMap } = ctxFor([task], [project]);

    const [first] = computeScoreUpdates([task], projectMap, ctx, TODAY);
    const reordered = Object.fromEntries(
      Object.entries(first!.breakdown).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)),
    );
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(first!.breakdown));

    const stored: Task = { ...task, score: first!.score, scoreBreakdown: reordered };
    expect(computeScoreUpdates([stored], projectMap, ctx, TODAY)).toHaveLength(0);
  });

  it('reporta de novo quando o score salvo diverge do recém-calculado', () => {
    const project = makeProject({ id: 's' });
    const task = makeTask({ score: 999, scoreBreakdown: {} });
    const { ctx, projectMap } = ctxFor([task], [project]);

    const updates = computeScoreUpdates([task], projectMap, ctx, TODAY);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.score).not.toBe(999);
  });

  it('usa taskId (não o id de documento) quando presente', () => {
    const project = makeProject({ id: 's' });
    const task = makeTask({ id: 'doc-abc', taskId: 42 });
    const { ctx, projectMap } = ctxFor([task], [project]);

    const [update] = computeScoreUpdates([task], projectMap, ctx, TODAY);
    expect(update!.docId).toBe('42');
  });
});
