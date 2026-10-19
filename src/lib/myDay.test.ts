import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../types';

// `myDay.ts` importa taskMutations (e, por ele, o cliente Supabase); aqui só
// as funções puras são exercitadas.
vi.mock('./taskMutations', () => ({ patchTask: vi.fn() }));

const { computeReorderUpdates, getMyDayTasks, isInMyDay } = await import('./myDay');

function makeTask(id: string, myDayOrder?: number | null): Task {
  return {
    id,
    taskId: Number(id),
    title: `[#${id}] t`,
    note: '',
    checked: false,
    inProgress: false,
    moscow: '',
    modo: 'manual',
    esforco: '',
    deadline: '',
    addedDate: '2026-01-01',
    dependsOn: [],
    section: '',
    completedAt: null,
    tags: [],
    myDayOrder,
  };
}

describe('getMyDayTasks', () => {
  it('ignora tarefas fora da lista e ordena pela posição', () => {
    const tasks = [makeTask('1', 30), makeTask('2'), makeTask('3', 10), makeTask('4', null), makeTask('5', 20)];
    expect(getMyDayTasks(tasks).map((t) => t.id)).toEqual(['3', '5', '1']);
  });

  it('trata a posição 0 como "dentro da lista"', () => {
    expect(isInMyDay(makeTask('1', 0))).toBe(true);
    expect(getMyDayTasks([makeTask('1', 0)])).toHaveLength(1);
  });

  it('desempata pelo id para manter a ordem estável', () => {
    const tasks = [makeTask('b', 5), makeTask('a', 5)];
    expect(getMyDayTasks(tasks).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('computeReorderUpdates', () => {
  it('renumera para índices consecutivos, gravando só o que mudou', () => {
    const tasks = [makeTask('1', 0), makeTask('2', 1), makeTask('3', 2)];
    // 3 sobe para o topo: todas mudam de posição.
    const moved = computeReorderUpdates(['3', '1', '2'], tasks);
    expect(moved.map((u) => [u.task.id, u.myDayOrder])).toEqual([
      ['3', 0],
      ['1', 1],
      ['2', 2],
    ]);
    // Ordem inalterada: nada a gravar.
    expect(computeReorderUpdates(['1', '2', '3'], tasks)).toEqual([]);
  });

  it('converte posições baseadas em timestamp para índices pequenos', () => {
    const tasks = [makeTask('1', 1_760_000_000_000), makeTask('2', 1_760_000_000_500)];
    const out = computeReorderUpdates(['2', '1'], tasks);
    expect(out.map((u) => u.myDayOrder)).toEqual([0, 1]);
  });

  it('ignora ids desconhecidos', () => {
    expect(computeReorderUpdates(['x'], [makeTask('1', 0)])).toEqual([]);
  });
});
