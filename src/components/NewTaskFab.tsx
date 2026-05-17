import { useState } from 'react';
import type { Project, Task } from '../types';
import { NewTaskPage } from './NewTaskPage';

export function NewTaskFab({
  uid,
  projects,
  allTasks,
  defaultProjectId,
}: {
  uid: string;
  projects: Project[];
  allTasks: Task[];
  defaultProjectId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="fab"
        onClick={() => setOpen(true)}
        aria-label="adicionar tarefa"
        title="adicionar tarefa"
      >
        +
      </button>
      {open && (
        <NewTaskPage
          uid={uid}
          projects={projects}
          allTasks={allTasks}
          defaultProjectId={defaultProjectId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
