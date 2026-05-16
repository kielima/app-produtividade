import {
  deleteProjectWithTasks,
  patchProject,
  setProjectMoscow,
} from '../repositories/projectsRepo';
import type { MoSCoW, Project } from '../types';
import { InlineEdit } from './InlineEdit';
import { Popover } from './Popover';

const MOSCOW_LABEL: Record<MoSCoW, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
  '': '—',
};

const MOSCOW_OPTS: MoSCoW[] = ['must', 'should', 'could', 'wont', ''];

export function SectionHeader({
  uid,
  project,
  taskCount,
}: {
  uid: string;
  project: Project;
  taskCount: number;
}) {
  async function rename(newName: string) {
    if (!newName || newName === project.name) return;
    await patchProject(uid, project.id, { name: newName });
  }

  async function setMoscow(m: MoSCoW) {
    await setProjectMoscow(uid, project.id, m);
  }

  async function handleDelete() {
    const msg =
      taskCount > 0
        ? `Apagar o projeto "${project.name}" e ${taskCount} tarefa(s) dentro dele?`
        : `Apagar o projeto "${project.name}"?`;
    if (!window.confirm(msg)) return;
    await deleteProjectWithTasks(uid, project.id);
  }

  return (
    <header className="section-header">
      <InlineEdit value={project.name} onSave={rename} className="section-title" />
      <Popover
        trigger={(open) => (
          <button type="button" className={`badge moscow-${project.moscow}`} onClick={open}>
            {MOSCOW_LABEL[project.moscow]}
          </button>
        )}
      >
        {(close) => (
          <ul className="picker-list">
            {MOSCOW_OPTS.map((v) => (
              <li key={v}>
                <button
                  type="button"
                  className={v === project.moscow ? 'active' : ''}
                  onClick={() => {
                    setMoscow(v);
                    close();
                  }}
                >
                  {MOSCOW_LABEL[v]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      <span className="muted">{taskCount} tarefa{taskCount === 1 ? '' : 's'}</span>
      <button
        type="button"
        className="icon-btn danger"
        onClick={handleDelete}
        aria-label="apagar projeto"
        title="apagar projeto"
      >
        🗑
      </button>
    </header>
  );
}
