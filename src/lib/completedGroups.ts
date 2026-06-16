import type { Task } from '../types';

// Buckets relativos para a tela de tarefas concluídas. A ordem do array é a
// ordem de exibição (mais recente → mais antigo).
export type CompletedGroupKey =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'older';

export interface CompletedGroup {
  key: CompletedGroupKey;
  label: string;
  tasks: Task[];
}

const GROUP_ORDER: CompletedGroupKey[] = [
  'today',
  'yesterday',
  'week',
  'month',
  'older',
];

const GROUP_LABELS: Record<CompletedGroupKey, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  week: 'Esta semana',
  month: 'Este mês',
  older: 'Mais antigas',
};

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

// Início da semana civil (domingo), alinhado com o resto da app.
function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() - c.getDay());
  return c;
}

/**
 * Classifica uma data de conclusão num dos buckets relativos. Hoje e ontem
 * têm prioridade sobre semana/mês para que um item de ontem nunca apareça em
 * "Esta semana" mesmo na viragem de semana (domingo→segunda).
 */
export function bucketForDate(
  completedAt: Date,
  now: Date = new Date(),
): CompletedGroupKey {
  const today = startOfDay(now);
  const day = startOfDay(completedAt);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (day >= startOfWeek(now)) return 'week';
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (day >= startMonth) return 'month';
  return 'older';
}

/**
 * Filtra as tarefas concluídas (`checked` com `completedAt`), ordena da mais
 * recente para a mais antiga e agrupa por bucket relativo. Grupos vazios são
 * omitidos.
 */
export function groupCompletedTasks(
  tasks: Task[],
  now: Date = new Date(),
): CompletedGroup[] {
  const completed = tasks
    .filter((t) => t.checked && t.completedAt)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());

  const byKey = new Map<CompletedGroupKey, Task[]>();
  for (const t of completed) {
    const key = bucketForDate(t.completedAt!, now);
    const arr = byKey.get(key);
    if (arr) arr.push(t);
    else byKey.set(key, [t]);
  }

  return GROUP_ORDER.filter((k) => byKey.has(k)).map((k) => ({
    key: k,
    label: GROUP_LABELS[k],
    tasks: byKey.get(k)!,
  }));
}
