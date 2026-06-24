import type { Task } from '../types';

/**
 * "Adiar" / silenciar temporário de tarefas.
 *
 * Uma tarefa fica adiada enquanto `snoozedUntil` aponta para um instante ainda
 * no futuro: ela some das listas principais (Prioridade, Top 3 de Hoje) e
 * reaparece automaticamente quando esse instante chega. Serve para tarefas que
 * estão temporariamente impedidas de serem feitas — adiá-las reduz a ansiedade
 * de vê-las pendentes sem poder agir.
 *
 * `snoozedUntil` aceita dois formatos:
 *  - `YYYY-MM-DD` — adiamento por dia. A tarefa reaparece NO início desse dia
 *    (meia-noite local). Usado por "adiar por N dias" e por "adiar até a data"
 *    escolhida no calendário. Convenção de borda: está adiada enquanto a data
 *    é maior que hoje; quando chega o dia, volta a ser ativa.
 *  - `YYYY-MM-DDTHH:mm` — adiamento por horas. A tarefa reaparece nesse exato
 *    minuto (horário local). Usado por "adiar por N horas".
 */

/** Opções pré-definidas de adiamento por dia. */
export const SNOOZE_PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: '1 dia' },
  { days: 3, label: '3 dias' },
  { days: 7, label: '1 semana' },
  { days: 14, label: '2 semanas' },
  { days: 30, label: '1 mês' },
];

/** Opções pré-definidas de adiamento por horas. */
export const SNOOZE_HOUR_PRESETS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 1, label: '1 hora' },
  { hours: 3, label: '3 horas' },
  { hours: 6, label: '6 horas' },
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

/**
 * Instante (YYYY-MM-DDTHH:mm, horário local) até o qual a tarefa fica adiada ao
 * silenciá-la por `hours` horas a partir de `from`. Reaparece nesse minuto.
 */
export function snoozeUntilForHours(hours: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + Math.max(1, Math.round(hours * 60)));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${todayISO(d)}T${hh}:${mm}`;
}

/** True se `snoozedUntil` carrega horário (formato `...THH:mm`). */
export function hasTime(iso: string): boolean {
  return iso.includes('T');
}

/** Epoch ms (horário local) do instante representado por `snoozedUntil`. */
function snoozedUntilMs(iso: string): number {
  if (hasTime(iso)) {
    const [date, time] = iso.split('T');
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).getTime();
  }
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}

/**
 * Epoch ms do instante de referência. Aceita um `Date` (instante exato) ou uma
 * data `YYYY-MM-DD`, interpretada como meia-noite local desse dia.
 */
function refMs(now: Date | string): number {
  if (typeof now === 'string') {
    const [y, m, d] = now.split('-').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
  }
  return now.getTime();
}

/** True se a tarefa está adiada (silenciada) no instante de referência. */
export function isSnoozed(
  task: Pick<Task, 'snoozedUntil'>,
  now: Date | string = new Date(),
): boolean {
  const until = task.snoozedUntil;
  if (!until) return false;
  return snoozedUntilMs(until) > refMs(now);
}

/** Timestamp UTC (ms) só da parte de data de `s` — diferença de dias estável. */
function parseDateUTC(s: string): number {
  const date = hasTime(s) ? (s.split('T')[0] as string) : s;
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * Dias restantes até a tarefa reaparecer. 0 quando não está adiada (ou já
 * venceu), ou quando o adiamento por horas reaparece ainda hoje.
 */
export function snoozeDaysRemaining(
  task: Pick<Task, 'snoozedUntil'>,
  now: Date | string = new Date(),
): number {
  if (!isSnoozed(task, now)) return 0;
  const todayStr = typeof now === 'string' ? now : todayISO(now);
  const diff = parseDateUTC(task.snoozedUntil!) - parseDateUTC(todayStr);
  return Math.max(0, Math.round(diff / 86_400_000));
}

/** Minutos restantes até a tarefa reaparecer. 0 quando não está adiada. */
export function snoozeMinutesRemaining(
  task: Pick<Task, 'snoozedUntil'>,
  now: Date = new Date(),
): number {
  const until = task.snoozedUntil;
  if (!until) return 0;
  return Math.max(0, Math.round((snoozedUntilMs(until) - now.getTime()) / 60_000));
}

/**
 * Rótulo curto do tempo restante de adiamento: "3 dias" para adiamentos por
 * dia, "5h" / "20 min" para adiamentos por hora. Vazio se não estiver adiada.
 */
export function snoozeRemainingLabel(
  task: Pick<Task, 'snoozedUntil'>,
  now: Date = new Date(),
): string {
  const until = task.snoozedUntil;
  if (!until || !isSnoozed(task, now)) return '';
  if (hasTime(until)) {
    const mins = snoozeMinutesRemaining(task, now);
    if (mins >= 60) return `${Math.round(mins / 60)}h`;
    return `${Math.max(1, mins)} min`;
  }
  const days = snoozeDaysRemaining(task, now);
  return `${days} dia${days === 1 ? '' : 's'}`;
}

/** Formata a parte de data de `iso` (data ou timestamp) como DD/MM. */
export function formatSnoozeDate(iso: string): string {
  const date = hasTime(iso) ? (iso.split('T')[0] as string) : iso;
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

/**
 * Rótulo "até quando" para exibição. Adiamento por dia → DD/MM. Adiamento por
 * hora → HH:mm quando reaparece ainda hoje, senão DD/MM HH:mm.
 */
export function formatSnoozeUntil(iso: string, now: Date = new Date()): string {
  if (!hasTime(iso)) return formatSnoozeDate(iso);
  const [date, time] = iso.split('T');
  const hhmm = time.slice(0, 5);
  if (date === todayISO(now)) return hhmm;
  return `${formatSnoozeDate(iso)} ${hhmm}`;
}
