import { ColumnedTaskView, type ColumnSpec } from '../components/ColumnedTaskView';
import { isTaskBlocked } from '../lib/score';
import type { Project, ScoreContext, Task } from '../types';

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
  projects,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  projects: Project[];
  ctx: ScoreContext;
}) {
  return (
    <ColumnedTaskView
      uid={uid}
      tasks={tasks}
      projects={projects}
      allTasks={tasks}
      blocked={(t) => isTaskBlocked(t, ctx)}
      columns={COLUMNS}
      groupBy={groupBy}
      applyChange={applyChange}
      emptyHint="solte aqui para mudar status"
    />
  );
}
