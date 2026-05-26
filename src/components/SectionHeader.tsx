import { deleteProjectWithTasks, patchProject } from '../repositories/projectsRepo';
import type { Project } from '../types';
import { InlineEdit } from './InlineEdit';
import TrashIcon from './TrashIcon';

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
      <span className="muted">{taskCount} tarefa{taskCount === 1 ? '' : 's'}</span>
      <button
        type="button"
        className="icon-btn danger"
        onClick={handleDelete}
        aria-label="apagar projeto"
        title="apagar projeto"
      >
        <TrashIcon size={18} />
      </button>
    </header>
  );
}
