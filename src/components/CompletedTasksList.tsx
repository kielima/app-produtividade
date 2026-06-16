import { useMemo } from 'react';
import { groupCompletedTasks } from '../lib/completedGroups';
import type { Project, Task } from '../types';
import { TaskCard } from './TaskCard';

/**
 * Lista de tarefas concluídas agrupadas por data de conclusão (Hoje, Ontem,
 * Esta semana, Este mês, Mais antigas). Reaproveita o TaskCard — o checkbox
 * permite desmarcar uma conclusão diretamente daqui. O nome do projeto é
 * resolvido pelo projeto ativo e, em fallback, pelo snapshot guardado na
 * conclusão (`completedFromSectionName`), para sobreviver à remoção do projeto.
 */
export function CompletedTasksList({
  uid,
  tasks,
  projects,
}: {
  uid: string;
  tasks: Task[];
  projects: Project[];
}) {
  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const groups = useMemo(() => groupCompletedTasks(tasks), [tasks]);

  function resolveProjectName(task: Task): string {
    if (!task.section) return 'Sem projeto';
    return (
      projectNameById.get(task.section) ??
      task.completedFromSectionName ??
      '(projeto removido)'
    );
  }

  if (groups.length === 0) {
    return (
      <p className="muted">
        Nenhuma tarefa concluída ainda. Marque uma tarefa como concluída e ela
        aparece aqui, organizada por data.
      </p>
    );
  }

  return (
    <div className="completed-list">
      {groups.map((group) => (
        <section key={group.key} className="completed-group">
          <h3 className="completed-group-title">
            {group.label}
            <small className="completed-group-count">{group.tasks.length}</small>
          </h3>
          <div className="task-list">
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                uid={uid}
                task={task}
                blocked={false}
                projectName={resolveProjectName(task)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
