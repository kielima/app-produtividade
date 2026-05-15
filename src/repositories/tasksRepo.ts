import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Task } from '../types';

function tasksCol(uid: string) {
  return collection(db, 'users', uid, 'tasks');
}

export function subscribeToTasks(
  uid: string,
  cb: (tasks: Task[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    tasksCol(uid),
    (snap) => {
      const tasks: Task[] = snap.docs.map((d) => {
        const data = d.data() as Omit<Task, 'id'>;
        return { ...data, id: d.id };
      });
      cb(tasks);
    },
    (err) => onError?.(err),
  );
}

export async function upsertTask(uid: string, task: Task): Promise<void> {
  const id = task.taskId != null ? String(task.taskId) : task.id;
  await setDoc(doc(db, 'users', uid, 'tasks', id), { ...task, id }, { merge: true });
}
