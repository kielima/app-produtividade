import { getDisplayTitle } from '../lib/parser';
import type { Task } from '../types';

const MOSCOW_LABEL: Record<string, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
};

const ESFORCO_LABEL: Record<string, string> = {
  rapido: 'Rápido',
  medio: 'Médio',
  longo: 'Longo',
};

const MODO_LABEL: Record<string, string> = {
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
  automatizar: 'Automatizar',
};

export function TaskCard({ task, blocked }: { task: Task; blocked: boolean }) {
  const title = getDisplayTitle(task.title);
  const checkbox = task.checked ? '[x]' : task.inProgress ? '[-]' : '[ ]';

  return (
    <article className={`task-card${blocked ? ' dep-blocked' : ''}${task.checked ? ' done' : ''}`}>
      <div className="task-line">
        <span className="task-check" aria-label="status">
          {checkbox}
        </span>
        <span className="task-title">{title}</span>
      </div>
      <div className="task-badges">
        {task.moscow && (
          <span className={`badge moscow-${task.moscow}`}>{MOSCOW_LABEL[task.moscow]}</span>
        )}
        {task.modo && <span className={`badge modo-${task.modo}`}>{MODO_LABEL[task.modo]}</span>}
        {task.esforco && (
          <span className={`badge esforco-${task.esforco}`}>{ESFORCO_LABEL[task.esforco]}</span>
        )}
        {task.deadline && <span className="badge deadline">📅 {task.deadline}</span>}
        {task.dependsOn.length > 0 && (
          <span className="badge dep">🔗 {task.dependsOn.join(' ')}</span>
        )}
        {blocked && <span className="badge blocked">🔒 bloqueada</span>}
      </div>
      {task.note && <p className="task-note">{task.note}</p>}
      {task.subtasks.length > 0 && (
        <ul className="task-subtasks">
          {task.subtasks.map((s, i) => (
            <li key={i} className={s.checked ? 'done' : ''}>
              {s.checked ? '[x]' : '[ ]'} {s.text}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
