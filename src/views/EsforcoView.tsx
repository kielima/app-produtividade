import { ColumnedTaskView, type ColumnSpec } from '../components/ColumnedTaskView';
import { isTaskBlocked } from '../lib/score';
import type { Esforco, Project, ScoreContext, Task } from '../types';

const COLUMNS: ColumnSpec[] = [
  { key: 'rapido', label: 'Rápido', badgeClass: 'col-esforco-rapido' },
  { key: 'medio', label: 'Médio', badgeClass: 'col-esforco-medio' },
  { key: 'longo', label: 'Longo', badgeClass: 'col-esforco-longo' },
  { key: 'none', label: 'Sem classificação', badgeClass: 'col-none' },
];

function groupBy(task: Task): string {
  return task.esforco || 'none';
}

function applyChange(_task: Task, newKey: string): Partial<Task> {
  return { esforco: newKey === 'none' ? '' : (newKey as Esforco) };
}

export function EsforcoView({
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
      emptyHint="solte aqui para classificar esforço"
    />
  );
}
