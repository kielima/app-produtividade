import type { Task } from '../types';

/**
 * "Adiar" / silenciar temporário de tarefas.
 *
 * Uma tarefa fica adiada quando `snoozedUntil` (YYYY-MM-DD) é uma data ainda
 * no futuro: ela some das listas principais (Prioridade, Top 3 de Hoje) e
 * reaparece automaticamente no dia indicado. Serve para tarefas que estão
 * temporariamente impedidas de serem feitas — adiá-las reduz a ansiedade de
 * vê-las pendentes sem poder agir.
 *
 * Convenção de borda: a tarefa reaparece NO dia `snoozedUntil`. Ou seja, está
 * adiada enquanto `snoozedUntil > hoje`; quando `hoje >= snoozedUntil` volta a
 * ser ativa. Assim, "adiar por N dias" mantém a tarefa oculta por N dias.
 */

/** Opções pré-definidas oferecidas no seletor de adiamento. */
export const SNOOZE_PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: '1 dia' },
  { days: 3, label: '3 dias' },
  { days: 7, label: '1 semana' },
  { days: 14, label: '2 semanas' },
  { days: 30, label: '1 mês' },
];

/** Data de `d` no formato YYYY-MM-DD (horário local). */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Data (YYYY-MM-DD) até a qual a tarefa fica adiada ao silenciá-la por `days`
 * dias a partir de `from`. A tarefa reaparece exatamente nesse dia.
 */
export function snoozeUntilForDays(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(1, Math.round(days)));
  return todayISO(d);
}

/** Timestamp UTC (ms) de uma data YYYY-MM-DD — comparação estável sem TZ. */
function parseISO(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** True se a tarefa está adiada (silenciada) na data de referência. */
export function isSnoozed(
  task: Pick<Task, 'snoozedUntil'>,
  today: string = todayISO(),
): boolean {
  const until = task.snoozedUntil;
  if (!until) return false;
  return until > today;
}

/**
 * Dias restantes até a tarefa reaparecer. 0 quando não está adiada (ou já
 * venceu). Para uma tarefa adiada o valor é sempre >= 1.
 */
export function snoozeDaysRemaining(
  task: Pick<Task, 'snoozedUntil'>,
  today: string = todayISO(),
): number {
  if (!isSnoozed(task, today)) return 0;
  const diff = parseISO(task.snoozedUntil!) - parseISO(today);
  return Math.max(0, Math.round(diff / 86_400_000));
}

/** Formata uma data YYYY-MM-DD como DD/MM para exibição compacta. */
export function formatSnoozeDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
