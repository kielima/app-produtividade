import { ColumnedTaskView, type ColumnSpec } from '../components/ColumnedTaskView';
import { isTaskBlocked } from '../lib/score';
import type { Modo, ScoreContext, Task } from '../types';

const COLUMNS: ColumnSpec[] = [
  { key: 'manual', label: 'Manual', badgeClass: 'col-modo-manual' },
  { key: 'colaborar', label: 'Colaborar', badgeClass: 'col-modo-colaborar' },
  { key: 'delegar', label: 'Delegar', badgeClass: 'col-modo-delegar' },
];

function groupBy(task: Task): string {
  return task.modo;
}

function applyChange(_task: Task, newKey: string): Partial<Task> {
  return { modo: newKey as Modo };
}

export function ModoView({
  uid,
  tasks,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  ctx: ScoreContext;
}) {
  const visible = tasks.filter((t) => !t.checked);
  return (
    <ColumnedTaskView
      uid={uid}
      tasks={visible}
      blocked={(t) => isTaskBlocked(t, ctx)}
      columns={COLUMNS}
      groupBy={groupBy}
      applyChange={applyChange}
      emptyHint="solte aqui para definir modo"
    />
  );
}
