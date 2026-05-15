import { ColumnedTaskView, type ColumnSpec } from '../components/ColumnedTaskView';
import { isTaskBlocked } from '../lib/score';
import type { Modo, ScoreContext, Section, Task } from '../types';

const COLUMNS: ColumnSpec[] = [
  { key: 'manual', label: 'Manual', badgeClass: 'col-modo-manual' },
  { key: 'colaborar', label: 'Colaborar', badgeClass: 'col-modo-colaborar' },
  { key: 'delegar', label: 'Delegar', badgeClass: 'col-modo-delegar' },
  { key: 'automatizar', label: 'Automatizar', badgeClass: 'col-modo-automatizar' },
  { key: 'none', label: 'Sem modo', badgeClass: 'col-none' },
];

function groupBy(task: Task): string {
  return task.modo || 'none';
}

function applyChange(_task: Task, newKey: string): Partial<Task> {
  return { modo: newKey === 'none' ? '' : (newKey as Modo) };
}

export function ModoView({
  uid,
  tasks,
  sections,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  sections: Section[];
  ctx: ScoreContext;
}) {
  const visible = tasks.filter((t) => !t.checked);
  return (
    <ColumnedTaskView
      uid={uid}
      tasks={visible}
      sections={sections}
      allTasks={tasks}
      blocked={(t) => isTaskBlocked(t, ctx)}
      columns={COLUMNS}
      groupBy={groupBy}
      applyChange={applyChange}
      emptyHint="solte aqui para definir modo"
    />
  );
}
