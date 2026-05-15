import type { Firestore } from 'firebase-admin/firestore';
import type { ParseTasksResult } from '../../../src/lib/parser';
import type { Section, Task } from '../../../src/types';

const BATCH_LIMIT = 450; // firestore batch hard limit é 500 — folga pra metadados

export interface WriteTasksOptions {
  uid: string;
  dryRun: boolean;
}

export async function writeTasks(
  db: Firestore,
  data: ParseTasksResult,
  opts: WriteTasksOptions,
): Promise<{ sections: number; tasks: number }> {
  const userRef = db.collection('users').doc(opts.uid);
  const sectionsRef = userRef.collection('sections');
  const tasksRef = userRef.collection('tasks');

  let sectionCount = 0;
  let taskCount = 0;

  if (opts.dryRun) {
    sectionCount = data.sections.length;
    for (const s of data.sections) taskCount += data.tasks[s.id]?.length ?? 0;
    return { sections: sectionCount, tasks: taskCount };
  }

  // Sections
  for (let i = 0; i < data.sections.length; i += BATCH_LIMIT) {
    const slice = data.sections.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    slice.forEach((s: Section, idx) => {
      batch.set(
        sectionsRef.doc(s.id),
        { ...s, order: i + idx },
        { merge: true },
      );
    });
    await batch.commit();
    sectionCount += slice.length;
  }

  // Tasks
  const allTasks: Task[] = [];
  for (const s of data.sections) {
    for (const t of data.tasks[s.id] ?? []) allTasks.push(t);
  }
  for (let i = 0; i < allTasks.length; i += BATCH_LIMIT) {
    const slice = allTasks.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    slice.forEach((t) => {
      const id = t.taskId != null ? String(t.taskId) : t.id;
      batch.set(tasksRef.doc(id), { ...t, id }, { merge: true });
    });
    await batch.commit();
    taskCount += slice.length;
  }

  return { sections: sectionCount, tasks: taskCount };
}
