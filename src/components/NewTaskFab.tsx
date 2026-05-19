import { useState } from 'react';
import { serializeTitle } from '../lib/parser';
import { useTaskNavigation } from '../lib/taskNavigation';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
import type { Project, Task } from '../types';

function isHiddenProject(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

export function NewTaskFab({
  uid,
  projects,
  defaultProjectId,
}: {
  uid: string;
  projects: Project[];
  defaultProjectId: string;
}) {
  const [creating, setCreating] = useState(false);
  const { openTask } = useTaskNavigation();

  const available = projects.filter((p) => !isHiddenProject(p));
  const disabled = creating || available.length === 0;

  async function handleClick() {
    if (disabled) return;
    const sectionId =
      defaultProjectId && available.some((p) => p.id === defaultProjectId)
        ? defaultProjectId
        : available[0]!.id;
    setCreating(true);
    try {
      const taskId = await nextTaskId(uid);
      const today = new Date().toISOString().slice(0, 10);
      const newTask: Task = {
        id: String(taskId),
        taskId,
        title: serializeTitle('', {
          taskId,
          modo: 'manual',
          moscow: '',
          esforco: '',
          deadline: '',
          addedDate: today,
          dependsOn: [],
        }),
        note: '',
        checked: false,
        inProgress: false,
        moscow: '',
        modo: 'manual',
        esforco: '',
        deadline: '',
        addedDate: today,
        dependsOn: [],
        subtasks: [],
        section: sectionId,
      };
      await upsertTask(uid, newTask);
      openTask(String(taskId));
    } finally {
      setCreating(false);
    }
  }

  return (
    <button
      type="button"
      className="fab"
      onClick={handleClick}
      disabled={disabled}
      aria-label="adicionar tarefa"
      title={
        available.length === 0
          ? 'Crie um projeto antes de adicionar uma tarefa'
          : 'adicionar tarefa'
      }
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3v14M3 10h14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    </button>
  );
}
