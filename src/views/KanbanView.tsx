import { ColumnedTaskView, type ColumnSpec } from '../components/ColumnedTaskView';
import { isTaskBlocked } from '../lib/score';
import type { ScoreContext, Section, Task } from '../types';

const COLUMNS: ColumnSpec[] = [
  { key: 'todo', label: 'A fazer', badgeClass: 'col-todo' },
  { key: 'doing', label: 'Em andamento', badgeClass: 'col-doing' },
  { key: 'done', label: 'Concluída', badgeClass: 'col-done' },
];

function groupBy(task: Task): string {
  if (task.checked) return 'done';
  if (task.inProgress) return 'doing';
  return 'todo';
}

function applyChange(_task: Task, newKey: string): Partial<Task> {
  if (newKey === 'todo') return { checked: false, inProgress: false };
  if (newKey === 'doing') return { checked: false, inProgress: true };
  return { checked: true, inProgress: false };
}

export function KanbanView({
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
  return (
    <ColumnedTaskView
      uid={uid}
      tasks={tasks}
      sections={sections}
      allTasks={tasks}
      blocked={(t) => isTaskBlocked(t, ctx)}
      columns={COLUMNS}
      groupBy={groupBy}
      applyChange={applyChange}
      emptyHint="solte aqui para mudar status"
    />
  );
}
