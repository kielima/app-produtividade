import { describe, expect, it } from 'vitest';
import { buildProjectScoreMap } from './projectRankScore';
import {
  buildDependencyMap,
  calcDeadlinePoints,
  calcProjectDeadlinePoints,
  calcScore,
  isTaskBlocked,
} from './score';
import type { Section, Task } from '../types';

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
    subtasks: [],
    section: 's',
    ...overrides,
  };
}

const SECTION: Section = { id: 's', name: 'S', moscow: '' };
// Projeto único → score 3 (multiplicador máximo da curva).
const PSM_SINGLE = buildProjectScoreMap([{ id: 's' }]);

describe('calcDeadlinePoints', () => {
  it('returns 0 when no deadline', () => {
    expect(calcDeadlinePoints('', TODAY)).toBe(0);
  });
  it('hoje vale 10 quando maxOverdueScore=0', () => {
    expect(calcDeadlinePoints('2026-05-15', TODAY)).toBe(10);
  });
  it('amanhã vale 9 quando maxOverdueScore=0', () => {
    expect(calcDeadlinePoints('2026-05-16', TODAY)).toBe(9);
  });
  it('7 dias vale 3 quando maxOverdueScore=0', () => {
    expect(calcDeadlinePoints('2026-05-22', TODAY)).toBe(3);
  });
  it('futuro distante é cortado em 0', () => {
    expect(calcDeadlinePoints('2027-01-01', TODAY)).toBe(0);
  });
  it('escala com atraso: 5 + |dias|', () => {
    expect(calcDeadlinePoints('2026-05-14', TODAY)).toBe(6);
    expect(calcDeadlinePoints('2026-05-10', TODAY)).toBe(10);
  });
  it('soma maxOverdueScore ao bônus de upcoming', () => {
    // hoje, maxOverdue=20 → 20+10-0 = 30
    expect(calcDeadlinePoints('2026-05-15', TODAY, 20)).toBe(30);
    // amanhã, maxOverdue=20 → 29
    expect(calcDeadlinePoints('2026-05-16', TODAY, 20)).toBe(29);
    // 15 dias, maxOverdue=20 → 15
    expect(calcDeadlinePoints('2026-05-30', TODAY, 20)).toBe(15);
  });
  it('maxOverdueScore não afeta atrasadas', () => {
    expect(calcDeadlinePoints('2026-05-10', TODAY, 100)).toBe(10);
  });
});

describe('calcProjectDeadlinePoints', () => {
  it('returns 0 when no deadline', () => {
    expect(calcProjectDeadlinePoints(undefined, TODAY)).toBe(0);
    expect(calcProjectDeadlinePoints('', TODAY)).toBe(0);
  });
  it('hoje vale 10', () => {
    expect(calcProjectDeadlinePoints('2026-05-15', TODAY)).toBe(10);
  });
  it('amanhã vale 9', () => {
    expect(calcProjectDeadlinePoints('2026-05-16', TODAY)).toBe(9);
  });
  it('7 dias vale 3', () => {
    expect(calcProjectDeadlinePoints('2026-05-22', TODAY)).toBe(3);
  });
  it('futuro distante é cortado em 0', () => {
    expect(calcProjectDeadlinePoints('2027-01-01', TODAY)).toBe(0);
  });
  it('projeto atrasado não pontua (não considera atrasados)', () => {
    expect(calcProjectDeadlinePoints('2026-05-14', TODAY)).toBe(0);
    expect(calcProjectDeadlinePoints('2026-04-01', TODAY)).toBe(0);
  });
});

describe('calcScore', () => {
  it('returns 0 for Wont task', () => {
    const t = makeTask({ moscow: 'wont' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(0);
  });

  it('returns 0 when blocked by an open task', () => {
    const blocker = makeTask({ id: '1', taskId: 1, moscow: 'must' });
    const blocked = makeTask({ id: '2', taskId: 2, moscow: 'must', dependsOn: ['#1'] });
    const ctx = buildDependencyMap(
      [
        { task: blocker, section: SECTION },
        { task: blocked, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    expect(calcScore(blocked, SECTION, ctx, TODAY)).toBe(0);
  });

  it('unblocks when blocker is checked', () => {
    const blocker = makeTask({ id: '1', taskId: 1, moscow: 'must', checked: true });
    const blocked = makeTask({ id: '2', taskId: 2, moscow: 'must', dependsOn: ['#1'] });
    const ctx = buildDependencyMap(
      [
        { task: blocker, section: SECTION },
        { task: blocked, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    expect(calcScore(blocked, SECTION, ctx, TODAY)).toBeGreaterThan(0);
  });

  it('multiplies project rank-score by task MoSCoW', () => {
    const t = makeTask({ moscow: 'must' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // projectScore=3 (único projeto); taskMoSCoW(must)=3 → base = 9
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(9);
  });

  it('uses middle of 3 projects → projectScore ≈ 1.5', () => {
    const middleSection: Section = { id: 'mid', name: 'mid', moscow: '' };
    const psm = buildProjectScoreMap([{ id: 'top' }, { id: 'mid' }, { id: 'bot' }]);
    const t = makeTask({ moscow: 'must', section: 'mid' });
    const ctx = buildDependencyMap([{ task: t, section: middleSection }], psm, TODAY);
    // projectScore=1.5; taskMoSCoW(must)=3 → base=4.5
    expect(calcScore(t, middleSection, ctx, TODAY)).toBeCloseTo(4.5, 6);
  });

  it('bottom project (rank N) zeros out the base', () => {
    const botSection: Section = { id: 'bot', name: 'bot', moscow: '' };
    const psm = buildProjectScoreMap([{ id: 'top' }, { id: 'mid' }, { id: 'bot' }]);
    const t = makeTask({ moscow: 'must', section: 'bot' });
    const ctx = buildDependencyMap([{ task: t, section: botSection }], psm, TODAY);
    // projectScore=0 → base=0; sem bônus → 0
    expect(calcScore(t, botSection, ctx, TODAY)).toBe(0);
  });

  it('applies effort divisor', () => {
    const t = makeTask({ moscow: 'must', esforco: 'medio' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // projectScore=3 * taskMoSCoW(must)=3 → base=9; effort=2 → 4.5
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(4.5);
  });

  it('adds inProgress bonus', () => {
    const t = makeTask({ moscow: 'should', inProgress: true });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // projectScore=3 * taskMoSCoW(should)=2 → base=6; +1 inProgress = 7
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(7);
  });

  it('adds deadline bonus for hoje (sem atrasadas → maxOverdueScore=0)', () => {
    const t = makeTask({ moscow: 'should', deadline: '2026-05-15' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // base=6; deadlineBonus = max(0, 0+10-0) = 10 → 6 + 10 = 16
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(16);
  });

  it('upcoming task usa maxOverdueScore + 10 - d como bônus de prazo', () => {
    // Overdue 5 dias: must, base=9, deadlineBonus = 5+5=10 → 19
    const overdue = makeTask({ id: '1', taskId: 1, moscow: 'must', deadline: '2026-05-10' });
    // Upcoming em 2 dias
    const upcoming = makeTask({ id: '2', taskId: 2, moscow: 'must', deadline: '2026-05-17' });
    const ctx = buildDependencyMap(
      [
        { task: overdue, section: SECTION },
        { task: upcoming, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    expect(calcScore(overdue, SECTION, ctx, TODAY)).toBe(19);
    expect(ctx.maxOverdueScore).toBe(19);
    // upcoming: base=9, deadlineBonus = max(0, 19+10-2) = 27 → 36
    expect(calcScore(upcoming, SECTION, ctx, TODAY)).toBe(36);
  });

  it('upcoming task longe é cortada em 0 e fica só com o base', () => {
    const t = makeTask({ moscow: 'should', deadline: '2027-01-01' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // base=6; deadlineBonus = max(0, 0+10-231) = 0 → 6
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(6);
  });

  it('prazo do projeto entra no projectScore (multiplica com MoSCoW)', () => {
    const sec = { id: 's', deadline: '2026-05-17' };
    const t = makeTask({ moscow: 'should' });
    const ctx = buildDependencyMap([{ task: t, section: sec }], PSM_SINGLE, TODAY);
    // projectScore = 3 (rank) + 8 (10-2) = 11; base = 11 * 2 = 22
    expect(calcScore(t, sec, ctx, TODAY)).toBe(22);
  });

  it('bônus de prazo do projeto é 0 para projeto atrasado', () => {
    const sec = { id: 's', deadline: '2026-05-10' };
    const t = makeTask({ moscow: 'should' });
    const ctx = buildDependencyMap([{ task: t, section: sec }], PSM_SINGLE, TODAY);
    // base=6; projectDeadlineBonus = 0 (atrasado) → 6
    expect(calcScore(t, sec, ctx, TODAY)).toBe(6);
  });

  it('soma 1 ponto por subtarefa não-concluída no base', () => {
    const t = makeTask({
      moscow: 'should',
      subtasks: [
        { text: 'a', checked: false },
        { text: 'b', checked: false },
        { text: 'c', checked: true },
      ],
    });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // projectScore=3 * 2 = 6; subtaskBonus = 2 (só não-concluídas) → base = 8
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(8);
  });

  it('subtaskBonus é dividido pelo esforço', () => {
    const t = makeTask({
      moscow: 'should',
      esforco: 'medio',
      subtasks: [
        { text: 'a', checked: false },
        { text: 'b', checked: false },
      ],
    });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // base = 6 + 2 = 8; effort=2 → 4
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(4);
  });

  it('subtarefas concluídas não contam', () => {
    const t = makeTask({
      moscow: 'should',
      subtasks: [
        { text: 'a', checked: true },
        { text: 'b', checked: true },
      ],
    });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // subtaskBonus = 0 → base = 6
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(6);
  });

  it('bônus está fora da divisão de esforço', () => {
    // base=6, esforço=longo (effort=3), inProgress=true
    const t = makeTask({ moscow: 'should', esforco: 'longo', inProgress: true });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // Antigo: (6 + 1) / 3 = 2.33...
    // Novo:   (6/3) + 1 = 3
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(3);
  });

  it('adds age bonus = log2(days+1)', () => {
    const t = makeTask({ moscow: 'should', addedDate: '2026-05-08' }); // 7 dias atrás
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], PSM_SINGLE, TODAY);
    // base=6; ageBonus=log2(8)=3 → 9
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(9);
  });

  it('adds depBonus from unlockable tasks (potential scores)', () => {
    const unlocker = makeTask({ id: '1', taskId: 1, moscow: 'should' });
    const unlocked = makeTask({ id: '2', taskId: 2, moscow: 'must', dependsOn: ['#1'] });
    const ctx = buildDependencyMap(
      [
        { task: unlocker, section: SECTION },
        { task: unlocked, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    // unlocker: base = 3*2 = 6; potential = 6
    // unlocked (potential): base = 3*3 = 9
    // unlocker.calcScore = 6 + depBonus(9) = 15
    expect(ctx.potentialScoreMap['1']).toBe(6);
    expect(ctx.potentialScoreMap['2']).toBe(9);
    expect(calcScore(unlocker, SECTION, ctx, TODAY)).toBe(15);
  });

  it('depBonus sums entire transitive chain (A → B → C)', () => {
    const a = makeTask({ id: '1', taskId: 1, moscow: 'should' });
    const b = makeTask({ id: '2', taskId: 2, moscow: 'should', dependsOn: ['#1'] });
    const c = makeTask({ id: '3', taskId: 3, moscow: 'must', dependsOn: ['#2'] });
    const ctx = buildDependencyMap(
      [
        { task: a, section: SECTION },
        { task: b, section: SECTION },
        { task: c, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    // potentials: A=6, B=6, C=9
    // A desbloqueia transitivamente B e C → depBonus = 6 + 9 = 15
    // A.calcScore = base(6) + depBonus(15) = 21
    expect(ctx.transitiveUnlocksMap['1']!.sort()).toEqual(['2', '3']);
    expect(ctx.transitiveUnlocksMap['2']).toEqual(['3']);
    expect(ctx.transitiveUnlocksMap['3']).toEqual([]);
    expect(calcScore(a, SECTION, ctx, TODAY)).toBe(21);
    // B continua bloqueado por A (não-checked) → score 0
    expect(calcScore(b, SECTION, ctx, TODAY)).toBe(0);
  });

  it('transitive chain does not double-count diamond shapes', () => {
    // A desbloqueia B e C; B e C ambos desbloqueiam D.
    const a = makeTask({ id: '1', taskId: 1, moscow: 'should' });
    const b = makeTask({ id: '2', taskId: 2, moscow: 'should', dependsOn: ['#1'] });
    const c = makeTask({ id: '3', taskId: 3, moscow: 'should', dependsOn: ['#1'] });
    const d = makeTask({ id: '4', taskId: 4, moscow: 'must', dependsOn: ['#2', '#3'] });
    const ctx = buildDependencyMap(
      [
        { task: a, section: SECTION },
        { task: b, section: SECTION },
        { task: c, section: SECTION },
        { task: d, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    expect(ctx.transitiveUnlocksMap['1']!.sort()).toEqual(['2', '3', '4']);
    // depBonus para A = potential(B) + potential(C) + potential(D) = 6 + 6 + 9 = 21
    // A.calcScore = base(6) + 21 = 27
    expect(calcScore(a, SECTION, ctx, TODAY)).toBe(27);
  });

  it('handles cycles in unlocks chain without infinite loop', () => {
    // Ciclo A → B → A. Não deveria existir, mas o build precisa terminar.
    const a = makeTask({ id: '1', taskId: 1, moscow: 'should', dependsOn: ['#2'] });
    const b = makeTask({ id: '2', taskId: 2, moscow: 'should', dependsOn: ['#1'] });
    const ctx = buildDependencyMap(
      [
        { task: a, section: SECTION },
        { task: b, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    // Fecho transitivo de A não inclui A; só B.
    expect(ctx.transitiveUnlocksMap['1']).toEqual(['2']);
    expect(ctx.transitiveUnlocksMap['2']).toEqual(['1']);
  });

  it('returns base=0 when task has no matching project in the score map', () => {
    const t = makeTask({ moscow: 'must' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], {}, TODAY);
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(0);
  });
});

describe('isTaskBlocked', () => {
  it('detects open blockers', () => {
    const blocker = makeTask({ id: '1', taskId: 1 });
    const blocked = makeTask({ id: '2', taskId: 2, dependsOn: ['#1'] });
    const ctx = buildDependencyMap(
      [
        { task: blocker, section: SECTION },
        { task: blocked, section: SECTION },
      ],
      PSM_SINGLE,
      TODAY,
    );
    expect(isTaskBlocked(blocked, ctx)).toBe(true);
    expect(isTaskBlocked(blocker, ctx)).toBe(false);
  });
});
