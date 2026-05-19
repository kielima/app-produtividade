import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CompletedTask, Task } from '../types';

function tasksCol(uid: string) {
  return collection(db, 'users', uid, 'tasks');
}

function taskDocId(task: Pick<Task, 'taskId' | 'id'>): string {
  return task.taskId != null ? String(task.taskId) : task.id;
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
  const id = taskDocId(task);
  await setDoc(doc(db, 'users', uid, 'tasks', id), { ...task, id }, { merge: true });
}

export async function deleteTask(uid: string, task: Pick<Task, 'taskId' | 'id'>): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'tasks', taskDocId(task)));
}

/**
 * Atribui o próximo `taskId` (max+1 em `tasks/`) ao criar uma nova tarefa.
 * Lê uma vez todas as tarefas pra encontrar o max — aceitável pra o volume
 * esperado (~500 docs); paginar só quando passar de alguns milhares.
 */
export async function nextTaskId(uid: string): Promise<number> {
  const snap = await getDocs(tasksCol(uid));
  let max = 0;
  snap.forEach((d) => {
    const t = d.data() as Task;
    if (t.taskId != null && t.taskId > max) max = t.taskId;
  });
  return max + 1;
}

/**
 * Move tarefas com `checked=true` para `completedTasks/`, removendo de `tasks/`.
 * Idempotente. Retorna o número de tarefas arquivadas.
 */
export async function archiveCompletedTasks(uid: string): Promise<number> {
  const snap = await getDocs(tasksCol(uid));
  const toArchive: Task[] = [];
  snap.forEach((d) => {
    const t = { ...(d.data() as Omit<Task, 'id'>), id: d.id } as Task;
    if (t.checked) toArchive.push(t);
  });
  if (toArchive.length === 0) return 0;

  const BATCH_LIMIT = 200; // cada doc gera 2 ops (write + delete)
  for (let i = 0; i < toArchive.length; i += BATCH_LIMIT) {
    const slice = toArchive.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const t of slice) {
      const id = taskDocId(t);
      batch.set(
        doc(db, 'users', uid, 'completedTasks', id),
        { ...t, id, archivedAt: serverTimestamp(), archivedFromSection: t.section },
        { merge: true },
      );
      batch.delete(doc(db, 'users', uid, 'tasks', id));
    }
    await batch.commit();
  }
  return toArchive.length;
}

export function subscribeToCompletedTasks(
  uid: string,
  cb: (tasks: CompletedTask[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'users', uid, 'completedTasks'),
    (snap) => {
      const tasks: CompletedTask[] = snap.docs.map((d) => {
        const data = d.data() as Omit<CompletedTask, 'id'>;
        const raw = (data as { archivedAt?: unknown }).archivedAt;
        const archivedAt =
          raw instanceof Timestamp
            ? raw.toDate()
            : raw && typeof raw === 'object' && 'seconds' in (raw as object)
              ? new Date((raw as { seconds: number }).seconds * 1000)
              : null;
        return { ...data, id: d.id, archivedAt };
      });
      cb(tasks);
    },
    (err) => onError?.(err),
  );
}

export async function restoreCompletedTask(uid: string, taskId: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'completedTasks', taskId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const t = snap.data() as Task;
  const restored: Task = { ...t, checked: false };
  await setDoc(doc(db, 'users', uid, 'tasks', taskId), restored, { merge: true });
  await deleteDoc(ref);
}
