import { describe, expect, it } from 'vitest';
import { bucketForDate, groupCompletedTasks } from './completedGroups';
import type { Task } from '../types';

// Quarta-feira, 17 jun 2026, 12:00 — usado como "agora" fixo nos testes.
const NOW = new Date(2026, 5, 17, 12, 0, 0);

function at(d: Date): Task {
  return {
    id: 'x',
    taskId: null,
    title: 't',
    note: '',
    checked: true,
    inProgress: false,
    moscow: '',
    modo: 'manual',
    esforco: '',
    deadline: '',
    addedDate: '',
    dependsOn: [],
    subtasks: [],
    section: '',
    completedAt: d,
  };
}

describe('bucketForDate', () => {
  it('classifica hoje, mesmo de manhã', () => {
    expect(bucketForDate(new Date(2026, 5, 17, 8, 0), NOW)).toBe('today');
  });

  it('classifica ontem', () => {
    expect(bucketForDate(new Date(2026, 5, 16, 23, 0), NOW)).toBe('yesterday');
  });

  it('classifica dias anteriores da mesma semana como semana', () => {
    // Segunda 15 jun — mesma semana civil (domingo 14), nem hoje nem ontem.
    expect(bucketForDate(new Date(2026, 5, 15, 10, 0), NOW)).toBe('week');
  });

  it('classifica dias do mesmo mês fora da semana como mês', () => {
    expect(bucketForDate(new Date(2026, 5, 3, 10, 0), NOW)).toBe('month');
  });

  it('classifica meses anteriores como mais antigas', () => {
    expect(bucketForDate(new Date(2026, 3, 1, 10, 0), NOW)).toBe('older');
  });
});

describe('groupCompletedTasks', () => {
  it('ignora tarefas não concluídas ou sem completedAt', () => {
    const active = { ...at(NOW), checked: false };
    const noDate = { ...at(NOW), completedAt: null };
    expect(groupCompletedTasks([active, noDate], NOW)).toEqual([]);
  });

  it('agrupa, ordena grupos e ordena por mais recente dentro do grupo', () => {
    const todayEarly = { ...at(new Date(2026, 5, 17, 8, 0)), id: 'a' };
    const todayLate = { ...at(new Date(2026, 5, 17, 11, 0)), id: 'b' };
    const yest = { ...at(new Date(2026, 5, 16, 9, 0)), id: 'c' };
    const old = { ...at(new Date(2026, 0, 1, 9, 0)), id: 'd' };

    const groups = groupCompletedTasks([todayEarly, old, yest, todayLate], NOW);

    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'older']);
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(['b', 'a']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual(['c']);
    expect(groups[2]!.tasks.map((t) => t.id)).toEqual(['d']);
  });
});
