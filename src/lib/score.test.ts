import { describe, expect, it } from 'vitest';
import { buildDependencyMap, calcDeadlinePoints, calcScore, isTaskBlocked } from './score';
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
    modo: '',
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

describe('calcDeadlinePoints', () => {
  it('returns 0 when no deadline', () => {
    expect(calcDeadlinePoints('', TODAY)).toBe(0);
  });
  it('returns 4 for hoje', () => {
    expect(calcDeadlinePoints('2026-05-15', TODAY)).toBe(4);
  });
  it('returns 3 for amanhã', () => {
    expect(calcDeadlinePoints('2026-05-16', TODAY)).toBe(3);
  });
  it('returns 2 for essa semana (até 7 dias)', () => {
    expect(calcDeadlinePoints('2026-05-22', TODAY)).toBe(2);
  });
  it('returns 1 para futuro distante', () => {
    expect(calcDeadlinePoints('2027-01-01', TODAY)).toBe(1);
  });
  it('escala com atraso: 5 + |dias|', () => {
    expect(calcDeadlinePoints('2026-05-14', TODAY)).toBe(6);
    expect(calcDeadlinePoints('2026-05-10', TODAY)).toBe(10);
  });
});

describe('calcScore', () => {
  it('returns 0 for Wont task', () => {
    const t = makeTask({ moscow: 'wont' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], TODAY);
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
      TODAY,
    );
    expect(calcScore(blocked, SECTION, ctx, TODAY)).toBeGreaterThan(0);
  });

  it('uses section × task MoSCoW multiplicatively', () => {
    const t = makeTask({ moscow: 'must' });
    const sec: Section = { id: 's', name: 'S', moscow: 'must' };
    const ctx = buildDependencyMap([{ task: t, section: sec }], TODAY);
    // base = 3 * 3 = 9; effort=1; no addedDate; no deadline; no inProgress; no unlocks
    expect(calcScore(t, sec, ctx, TODAY)).toBe(9);
  });

  it('applies effort divisor', () => {
    const t = makeTask({ moscow: 'must', esforco: 'medio' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], TODAY);
    // base = 1 * 3 = 3; effort=2 → 1.5
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(1.5);
  });

  it('adds inProgress bonus', () => {
    const t = makeTask({ moscow: 'should', inProgress: true });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], TODAY);
    // base = 1 * 2 = 2; +1 inProgress = 3
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(3);
  });

  it('adds deadline bonus for hoje', () => {
    const t = makeTask({ moscow: 'should', deadline: '2026-05-15' });
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], TODAY);
    // base = 1 * 2 = 2; +4 hoje = 6
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(6);
  });

  it('adds age bonus = log2(days+1)', () => {
    const t = makeTask({ moscow: 'should', addedDate: '2026-05-08' }); // 7 days ago
    const ctx = buildDependencyMap([{ task: t, section: SECTION }], TODAY);
    // base = 1 * 2 = 2; ageBonus = log2(8) = 3 → 5
    expect(calcScore(t, SECTION, ctx, TODAY)).toBe(5);
  });

  it('adds depBonus from unlockable tasks (potential scores)', () => {
    const unlocker = makeTask({ id: '1', taskId: 1, moscow: 'should' });
    const unlocked = makeTask({ id: '2', taskId: 2, moscow: 'must', dependsOn: ['#1'] });
    const ctx = buildDependencyMap(
      [
        { task: unlocker, section: SECTION },
        { task: unlocked, section: SECTION },
      ],
      TODAY,
    );
    // unlocker: base = 1*1*2=2; potential = 2
    // unlocked (potential): base = 1*1*3=3
    // unlocker's calcScore = base(2) + depBonus(3) + 0 + 0 + 0 = 5
    expect(ctx.potentialScoreMap['1']).toBe(2);
    expect(ctx.potentialScoreMap['2']).toBe(3);
    expect(calcScore(unlocker, SECTION, ctx, TODAY)).toBe(5);
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
      TODAY,
    );
    expect(isTaskBlocked(blocked, ctx)).toBe(true);
    expect(isTaskBlocked(blocker, ctx)).toBe(false);
  });
});
