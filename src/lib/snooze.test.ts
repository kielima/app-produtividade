import { describe, expect, it } from 'vitest';
import {
  formatSnoozeDate,
  formatSnoozeUntil,
  isSnoozed,
  snoozeDaysRemaining,
  snoozeMinutesRemaining,
  snoozeRemainingLabel,
  snoozeUntilForDays,
  snoozeUntilForHours,
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

  it('snoozeUntilForHours soma N horas e inclui horário', () => {
    const from = new Date(2026, 5, 19, 10, 30);
    expect(snoozeUntilForHours(1, from)).toBe('2026-06-19T11:30');
    expect(snoozeUntilForHours(3, from)).toBe('2026-06-19T13:30');
    // atravessa a meia-noite
    expect(snoozeUntilForHours(6, new Date(2026, 5, 19, 20, 0))).toBe('2026-06-20T02:00');
  });

  it('snoozeUntilForHours trata horas < 1 como pelo menos 1 minuto', () => {
    const from = new Date(2026, 5, 19, 10, 30);
    expect(snoozeUntilForHours(0, from)).toBe('2026-06-19T10:31');
  });

  it('isSnoozed: futuro = adiada, hoje/passado = ativa (por dia)', () => {
    expect(isSnoozed({ snoozedUntil: '2026-06-22' }, '2026-06-19')).toBe(true);
    // reaparece NO dia snoozedUntil
    expect(isSnoozed({ snoozedUntil: '2026-06-19' }, '2026-06-19')).toBe(false);
    expect(isSnoozed({ snoozedUntil: '2026-06-10' }, '2026-06-19')).toBe(false);
  });

  it('isSnoozed: compara o instante exato em adiamentos por hora', () => {
    const now = new Date(2026, 5, 19, 12, 0);
    expect(isSnoozed({ snoozedUntil: '2026-06-19T14:00' }, now)).toBe(true);
    expect(isSnoozed({ snoozedUntil: '2026-06-19T11:00' }, now)).toBe(false);
    expect(isSnoozed({ snoozedUntil: '2026-06-19T12:00' }, now)).toBe(false);
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

  it('snoozeMinutesRemaining conta minutos até reaparecer', () => {
    const now = new Date(2026, 5, 19, 12, 0);
    expect(snoozeMinutesRemaining({ snoozedUntil: '2026-06-19T14:00' }, now)).toBe(120);
    expect(snoozeMinutesRemaining({ snoozedUntil: '2026-06-19T11:00' }, now)).toBe(0);
    expect(snoozeMinutesRemaining({ snoozedUntil: null }, now)).toBe(0);
  });

  it('snoozeRemainingLabel formata dias ou horas/minutos', () => {
    expect(snoozeRemainingLabel({ snoozedUntil: '2026-06-22' }, new Date(2026, 5, 19))).toBe(
      '3 dias',
    );
    expect(snoozeRemainingLabel({ snoozedUntil: '2026-06-20' }, new Date(2026, 5, 19))).toBe(
      '1 dia',
    );
    const now = new Date(2026, 5, 19, 12, 0);
    expect(snoozeRemainingLabel({ snoozedUntil: '2026-06-19T15:00' }, now)).toBe('3h');
    expect(snoozeRemainingLabel({ snoozedUntil: '2026-06-19T12:20' }, now)).toBe('20 min');
    expect(snoozeRemainingLabel({ snoozedUntil: null }, now)).toBe('');
  });

  it('formatSnoozeDate gera DD/MM (data ou timestamp)', () => {
    expect(formatSnoozeDate('2026-06-22')).toBe('22/06');
    expect(formatSnoozeDate('2026-12-01')).toBe('01/12');
    expect(formatSnoozeDate('2026-06-19T14:00')).toBe('19/06');
  });

  it('formatSnoozeUntil: data → DD/MM; hora hoje → HH:mm; hora outro dia → DD/MM HH:mm', () => {
    const now = new Date(2026, 5, 19, 12, 0);
    expect(formatSnoozeUntil('2026-06-22', now)).toBe('22/06');
    expect(formatSnoozeUntil('2026-06-19T14:30', now)).toBe('14:30');
    expect(formatSnoozeUntil('2026-06-20T02:00', now)).toBe('20/06 02:00');
  });
});
