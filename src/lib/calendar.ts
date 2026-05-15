/**
 * Helpers de calendário em pt-BR. Trabalha com strings ISO YYYY-MM-DD
 * para casar com o formato de `task.deadline`.
 */

export const DAY_NAMES_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export interface CalendarCell {
  iso: string;            // YYYY-MM-DD
  dayNum: number;         // 1..31
  inMonth: boolean;       // false para padding
  isToday: boolean;
  isWeekend: boolean;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(): string {
  return isoFromDate(new Date());
}

export function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

export function monthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Constrói o grid mensal com padding de dias do mês anterior/próximo
 * para preencher semanas completas (sempre múltiplos de 7).
 */
export function buildMonthGrid(reference: Date): CalendarCell[] {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Dom

  // Começa do domingo da semana que contém o dia 1
  const start = new Date(year, month, 1 - startWeekday);
  const today = todayIso();

  const cells: CalendarCell[] = [];
  // 6 semanas × 7 dias = 42 cells (cobre qualquer mês)
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoFromDate(d);
    cells.push({
      iso,
      dayNum: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: iso === today,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    });
  }

  // Trim trailing weeks que tenham só dias fora do mês
  // (mantém pelo menos 4 semanas para visual consistente)
  while (cells.length > 28 && cells.slice(-7).every((c) => !c.inMonth)) {
    cells.length -= 7;
  }
  return cells;
}
