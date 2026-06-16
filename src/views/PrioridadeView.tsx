import { useMemo } from 'react';
import { TaskCard } from '../components/TaskCard';
import { calcScore, isTaskBlocked } from '../lib/score';
import type { Project, ScoreContext, Task } from '../types';

/**
 * Lista única ordenada por score descendente. Tarefas com score 0 (Won't
 * ou bloqueadas) ficam no fim. Não há D&D — a ordem é derivada dos campos
 * (MoSCoW, esforço, prazo, etc.); para mudar a prioridade o usuário abre a
 * página da tarefa.
 */
export function PrioridadeView({
  uid,
  tasks,
  projectMap,
  ctx,
  hideZero,
}: {
  uid: string;
  tasks: Task[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
  hideZero: boolean;
}) {
  const scored = useMemo(() => {
    return tasks
      .map((t) => ({
        task: t,
        score: calcScore(t, projectMap[t.section] ?? null, ctx),
      }))
      .filter((x) => (hideZero ? x.score > 0 : true))
      .sort((a, b) => b.score - a.score);
  }, [tasks, projectMap, ctx, hideZero]);

  return (
    <section className="prioridade-view">
      <div className="task-list prioridade-list">
        {scored.map(({ task, score }) => (
          <TaskCard
            key={task.id}
            uid={uid}
            task={task}
            blocked={isTaskBlocked(task, ctx)}
            score={score}
            projectName={projectMap[task.section]?.name}
          />
        ))}
        {scored.length === 0 && <p className="muted">Nenhuma tarefa.</p>}
      </div>
    </section>
  );
}
