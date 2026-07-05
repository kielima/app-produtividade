import { describe, expect, it } from 'vitest';
import {
  buildChildStatsMap,
  getChildren,
  getDescendantIds,
  hasIncompleteChildren,
  isOrphaned,
} from './taskHierarchy';
import type { Task } from '../types';

function mk(id: string, parentId: string | null, checked = false): Task {
  return {
    id,
    taskId: Number(id),
    title: `Tarefa ${id}`,
    note: '',
    checked,
    inProgress: false,
    moscow: '',
    modo: 'manual',
    esforco: '',
    deadline: '',
    addedDate: '',
    dependsOn: [],
    subtasks: [],
    parentId,
    section: 'p',
    completedAt: null,
  };
}

const tasks: Task[] = [
  mk('1', null),
  mk('2', '1', true), // filha concluída
  mk('3', '1', false), // filha aberta
  mk('4', '3', false), // neta
  mk('5', null),
];

describe('taskHierarchy', () => {
  it('getChildren retorna só filhas diretas', () => {
    expect(getChildren('1', tasks).map((t) => t.id)).toEqual(['2', '3']);
    expect(getChildren('5', tasks)).toEqual([]);
  });

  it('getDescendantIds inclui netas e não a própria', () => {
    expect([...getDescendantIds('1', tasks)].sort()).toEqual(['2', '3', '4']);
  });

  it('hasIncompleteChildren detecta filhas abertas (direta)', () => {
    expect(hasIncompleteChildren('1', tasks)).toBe(true);
    expect(hasIncompleteChildren('3', tasks)).toBe(true);
    expect(hasIncompleteChildren('2', tasks)).toBe(false);
  });

  it('buildChildStatsMap conta total/done por pai', () => {
    const map = buildChildStatsMap(tasks);
    expect(map['1']).toEqual({ total: 2, done: 1 });
    expect(map['3']).toEqual({ total: 1, done: 0 });
    expect(map['5']).toBeUndefined();
  });

  it('isOrphaned detecta parentId apontando para tarefa inexistente', () => {
    const withZombie = [...tasks, mk('6', 'pai-apagado')];
    expect(isOrphaned(withZombie.find((t) => t.id === '6')!, withZombie)).toBe(true);
    expect(isOrphaned(withZombie.find((t) => t.id === '2')!, withZombie)).toBe(false);
    expect(isOrphaned(withZombie.find((t) => t.id === '1')!, withZombie)).toBe(false);
  });
});
