import { useMemo, useState } from 'react';
import { TaskCard } from '../components/TaskCard';
import { calcScore, isTaskBlocked } from '../lib/score';
import type { ScoreContext, Section, Task } from '../types';

/**
 * Lista única ordenada por score descendente. Tarefas com score 0 (Won't
 * ou bloqueadas) ficam no fim. Não há D&D — a ordem é derivada dos campos
 * (MoSCoW, esforço, prazo, etc.); para mudar a prioridade o usuário edita
 * os badges no próprio card.
 */
export function PrioridadeView({
  uid,
  tasks,
  sections,
  sectionMap,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  sections: Section[];
  sectionMap: Record<string, Section>;
  ctx: ScoreContext;
}) {
  const [hideZero, setHideZero] = useState(true);
  const [hideCompleted, setHideCompleted] = useState(true);

  const scored = useMemo(() => {
    return tasks
      .filter((t) => (hideCompleted ? !t.checked : true))
      .map((t) => ({
        task: t,
        score: calcScore(t, sectionMap[t.section] ?? null, ctx),
      }))
      .filter((x) => (hideZero ? x.score > 0 : true))
      .sort((a, b) => b.score - a.score);
  }, [tasks, sectionMap, ctx, hideZero, hideCompleted]);

  return (
    <section className="prioridade-view">
      <header className="filters">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
          />
          &nbsp;ocultar score 0
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          &nbsp;ocultar concluídas
        </label>
        <span className="counter">{scored.length} tarefas</span>
      </header>

      <div className="task-list prioridade-list">
        {scored.map(({ task, score }) => (
          <div key={task.id} className="prioridade-row">
            <span className="prioridade-score" title="score calculado pelo engine">
              {score.toFixed(2)}
            </span>
            <div className="prioridade-card-wrap">
              <TaskCard
                uid={uid}
                task={task}
                blocked={isTaskBlocked(task, ctx)}
                sections={sections}
                allTasks={tasks}
              />
            </div>
          </div>
        ))}
        {scored.length === 0 && <p className="muted">Nenhuma tarefa com score &gt; 0.</p>}
      </div>
    </section>
  );
}
