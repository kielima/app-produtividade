import { useState } from 'react';
import { upsertTask, nextTaskId } from '../repositories/tasksRepo';
import { serializeTitle } from '../lib/parser';
import type { Task } from '../types';

export function NewTaskInput({
  uid,
  sectionId,
}: {
  uid: string;
  sectionId: string;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const taskId = await nextTaskId(uid);
      const today = new Date().toISOString().slice(0, 10);
      const newTask: Task = {
        id: String(taskId),
        taskId,
        title: serializeTitle(text, {
          taskId,
          modo: '',
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
        modo: '',
        esforco: '',
        deadline: '',
        addedDate: today,
        dependsOn: [],
        subtasks: [],
        section: sectionId,
      };
      await upsertTask(uid, newTask);
      setDraft('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="new-task-row">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="+ nova tarefa nesta seção…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setDraft('');
        }}
        disabled={saving}
        className="new-task-input"
      />
    </div>
  );
}
