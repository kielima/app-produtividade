import { describe, expect, it } from 'vitest';
import { buildMonthGrid, isoFromDate, monthLabel, shiftMonth } from './calendar';

describe('isoFromDate', () => {
  it('formats YYYY-MM-DD with zero-padding', () => {
    expect(isoFromDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoFromDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('monthLabel', () => {
  it('formats month + year in pt-BR', () => {
    expect(monthLabel(new Date(2026, 4, 15))).toBe('Maio 2026');
    expect(monthLabel(new Date(2027, 0, 1))).toBe('Janeiro 2027');
  });
});

describe('shiftMonth', () => {
  it('navigates months without DST drift', () => {
    expect(monthLabel(shiftMonth(new Date(2026, 4, 15), 1))).toBe('Junho 2026');
    expect(monthLabel(shiftMonth(new Date(2026, 0, 31), -1))).toBe('Dezembro 2025');
    expect(monthLabel(shiftMonth(new Date(2026, 11, 31), 1))).toBe('Janeiro 2027');
  });
});

describe('buildMonthGrid', () => {
  it('always starts on a Sunday and ends on a Saturday', () => {
    const grid = buildMonthGrid(new Date(2026, 4, 15));
    expect(new Date(grid[0]!.iso + 'T00:00:00').getDay()).toBe(0);
    expect(new Date(grid[grid.length - 1]!.iso + 'T00:00:00').getDay()).toBe(6);
    expect(grid.length % 7).toBe(0);
  });

  it('marks today and weekend correctly', () => {
    const today = new Date();
    const grid = buildMonthGrid(today);
    const todayCell = grid.find((c) => c.isToday);
    expect(todayCell).toBeDefined();
    expect(todayCell!.inMonth).toBe(true);
    expect(grid.some((c) => c.isWeekend)).toBe(true);
  });

  it('contains every day of the reference month', () => {
    const grid = buildMonthGrid(new Date(2026, 1, 15)); // Feb 2026
    const inMonth = grid.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(28); // Feb 2026 has 28 days
    expect(inMonth[0]!.dayNum).toBe(1);
    expect(inMonth[27]!.dayNum).toBe(28);
  });
});
