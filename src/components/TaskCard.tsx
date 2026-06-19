import type { CSSProperties } from 'react';
import { getDisplayTitle } from '../lib/parser';
import { formatSnoozeDate, isSnoozed } from '../lib/snooze';
import { patchTask } from '../lib/taskMutations';
import { useTaskNavigation } from '../lib/taskNavigation';
import type { Task } from '../types';

export function TaskCard({
  uid,
  task,
  blocked,
  score,
  projectName,
  childStats,
}: {
  uid: string;
  task: Task;
  blocked: boolean;
  score?: number;
  // Quando presente, mostra o nome do projeto por baixo do título. Usado em
  // listas planas (Prioridade, Top 3, Concluídas) onde o card não está já
  // agrupado por projeto.
  projectName?: string;
  // Progresso das subtarefas (filhas) desta tarefa, quando houver. Usado para
  // mostrar o contador e travar a conclusão enquanto houver filhas abertas.
  childStats?: { total: number; done: number };
}) {
  const display = getDisplayTitle(task.title);
  const { openTask } = useTaskNavigation();
  const snoozed = !task.checked && isSnoozed(task);
  const hasOpenChildren = !!childStats && childStats.done < childStats.total;
  const childProgressPct =
    childStats && childStats.total > 0
      ? Math.round((childStats.done / childStats.total) * 100)
      : null;

  async function toggleChecked() {
    if (!task.checked && hasOpenChildren) {
      window.alert('Conclua todas as subtarefas antes de concluir esta tarefa.');
      return;
    }
    await patchTask(uid, task, { checked: !task.checked });
  }

  return (
    <article
      className={`task-card${blocked ? ' dep-blocked' : ''}${snoozed ? ' snoozed' : ''}${task.checked ? ' done' : ''}`}
      style={
        childProgressPct !== null
          ? ({ '--progress-pct': `${childProgressPct}%` } as CSSProperties)
          : undefined
      }
    >
      {childProgressPct !== null && (
        <span className="task-progress-fill" aria-hidden="true" />
      )}
      <div className="task-line">
        <input
          type="checkbox"
          checked={task.checked}
          onChange={toggleChecked}
          aria-label="alternar concluída"
          className="task-checkbox"
        />
        <button
          type="button"
          className="task-title task-title-btn"
          onClick={() => openTask(task.id)}
          aria-label="abrir tarefa"
        >
          {display}
        </button>
        {childStats && childStats.total > 0 && (
          <span className="task-child-count" title="subtarefas concluídas">
            {childStats.done}/{childStats.total}
          </span>
        )}
        {snoozed && (
          <span
            className="task-snooze-tag"
            title={`Adiada até ${formatSnoozeDate(task.snoozedUntil!)}`}
          >
            💤 {formatSnoozeDate(task.snoozedUntil!)}
          </span>
        )}
        {score !== undefined && <span className="task-score">{score.toFixed(1)}</span>}
      </div>
      {projectName && <span className="task-project">{projectName}</span>}
    </article>
  );
}
