import { getDisplayTitle } from '../lib/parser';
import { patchTask } from '../lib/taskMutations';
import { useTaskNavigation } from '../lib/taskNavigation';
import type { Task } from '../types';

export function TaskCard({
  uid,
  task,
  blocked,
  score,
}: {
  uid: string;
  task: Task;
  blocked: boolean;
  score?: number;
}) {
  const display = getDisplayTitle(task.title);
  const { openTask } = useTaskNavigation();

  async function toggleChecked() {
    await patchTask(uid, task, { checked: !task.checked });
  }

  return (
    <article className={`task-card${blocked ? ' dep-blocked' : ''}${task.checked ? ' done' : ''}`}>
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
        {score !== undefined && <span className="task-score">{score.toFixed(1)}</span>}
      </div>
    </article>
  );
}
