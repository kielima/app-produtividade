import { ColumnedTaskView, type ColumnSpec } from '../components/ColumnedTaskView';
import { isTaskBlocked } from '../lib/score';
import type { MoSCoW, Project, ScoreContext, Task } from '../types';

const COLUMNS: ColumnSpec[] = [
  { key: 'must', label: 'Must', badgeClass: 'col-must' },
  { key: 'should', label: 'Should', badgeClass: 'col-should' },
  { key: 'could', label: 'Could', badgeClass: 'col-could' },
  { key: 'wont', label: "Won't", badgeClass: 'col-wont' },
  { key: 'none', label: 'Sem classificação', badgeClass: 'col-none' },
];

function groupBy(task: Task): string {
  return task.moscow || 'none';
}

function applyChange(_task: Task, newKey: string): Partial<Task> {
  return { moscow: newKey === 'none' ? '' : (newKey as MoSCoW) };
}

export function MoscowView({
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
  const visible = tasks.filter((t) => !t.checked);
  return (
    <ColumnedTaskView
      uid={uid}
      tasks={visible}
      projects={projects}
      allTasks={tasks}
      blocked={(t) => isTaskBlocked(t, ctx)}
      columns={COLUMNS}
      groupBy={groupBy}
      applyChange={applyChange}
      emptyHint="solte aqui para classificar"
    />
  );
}
