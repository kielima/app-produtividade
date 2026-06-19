import { describe, expect, it } from 'vitest';
import {
  formatSnoozeDate,
  isSnoozed,
  snoozeDaysRemaining,
  snoozeUntilForDays,
  todayISO,
} from './snooze';

describe('snooze', () => {
  it('todayISO formata data local como YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 5, 9))).toBe('2026-06-09');
    expect(todayISO(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('snoozeUntilForDays soma N dias a partir de hoje', () => {
    const from = new Date(2026, 5, 19);
    expect(snoozeUntilForDays(1, from)).toBe('2026-06-20');
    expect(snoozeUntilForDays(3, from)).toBe('2026-06-22');
    expect(snoozeUntilForDays(14, from)).toBe('2026-07-03');
  });

  it('snoozeUntilForDays trata dias < 1 como 1', () => {
    const from = new Date(2026, 5, 19);
    expect(snoozeUntilForDays(0, from)).toBe('2026-06-20');
    expect(snoozeUntilForDays(-5, from)).toBe('2026-06-20');
  });

  it('isSnoozed: futuro = adiada, hoje/passado = ativa', () => {
    expect(isSnoozed({ snoozedUntil: '2026-06-22' }, '2026-06-19')).toBe(true);
    // reaparece NO dia snoozedUntil
    expect(isSnoozed({ snoozedUntil: '2026-06-19' }, '2026-06-19')).toBe(false);
    expect(isSnoozed({ snoozedUntil: '2026-06-10' }, '2026-06-19')).toBe(false);
  });

  it('isSnoozed: sem data = nunca adiada', () => {
    expect(isSnoozed({ snoozedUntil: null }, '2026-06-19')).toBe(false);
    expect(isSnoozed({ snoozedUntil: undefined }, '2026-06-19')).toBe(false);
    expect(isSnoozed({}, '2026-06-19')).toBe(false);
  });

  it('snoozeDaysRemaining conta dias até reaparecer', () => {
    expect(snoozeDaysRemaining({ snoozedUntil: '2026-06-22' }, '2026-06-19')).toBe(3);
    expect(snoozeDaysRemaining({ snoozedUntil: '2026-06-20' }, '2026-06-19')).toBe(1);
    expect(snoozeDaysRemaining({ snoozedUntil: '2026-06-19' }, '2026-06-19')).toBe(0);
    expect(snoozeDaysRemaining({ snoozedUntil: null }, '2026-06-19')).toBe(0);
  });

  it('formatSnoozeDate gera DD/MM', () => {
    expect(formatSnoozeDate('2026-06-22')).toBe('22/06');
    expect(formatSnoozeDate('2026-12-01')).toBe('01/12');
  });
});
