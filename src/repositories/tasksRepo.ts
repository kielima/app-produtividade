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
import type { Task } from '../types';

function tasksCol(uid: string) {
  return collection(db, 'users', uid, 'tasks');
}

function taskDocId(task: Pick<Task, 'taskId' | 'id'>): string {
  return task.taskId != null ? String(task.taskId) : task.id;
}

function readCompletedAt(raw: unknown): Date | null {
  if (raw instanceof Timestamp) return raw.toDate();
  if (raw && typeof raw === 'object' && 'seconds' in (raw as object)) {
    return new Date((raw as { seconds: number }).seconds * 1000);
  }
  if (raw instanceof Date) return raw;
  return null;
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
        const completedAt = readCompletedAt(
          (data as { completedAt?: unknown }).completedAt,
        );
        return { ...data, id: d.id, completedAt };
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
 * Marca/desmarca uma tarefa como concluída. Ao marcar, grava o timestamp
 * de conclusão (`completedAt`) e um snapshot do nome do projeto naquele
 * momento (`completedFromSectionName`) — para que as estatísticas
 * continuem mostrando o nome mesmo se o projeto for deletado depois. Ao
 * desmarcar, ambos voltam a null.
 */
export async function setTaskCompleted(
  uid: string,
  task: Task,
  completed: boolean,
): Promise<void> {
  const id = taskDocId(task);
  const ref = doc(db, 'users', uid, 'tasks', id);
  if (completed) {
    let projectName: string | null = null;
    if (task.section) {
      try {
        const psnap = await getDoc(doc(db, 'users', uid, 'projects', task.section));
        if (psnap.exists()) {
          const data = psnap.data() as { name?: string };
          projectName = data.name ?? null;
        }
      } catch {
        // ignora — snapshot do nome é best-effort.
      }
    }
    await setDoc(
      ref,
      {
        checked: true,
        completedAt: serverTimestamp(),
        completedFromSectionName: projectName,
      },
      { merge: true },
    );
  } else {
    await setDoc(
      ref,
      { checked: false, completedAt: null, completedFromSectionName: null },
      { merge: true },
    );
  }
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
 * Migração one-shot: move tudo que estiver em `completedTasks/` para
 * `tasks/`, traduzindo `archivedAt`→`completedAt` e
 * `archivedFromSectionName`→`completedFromSectionName`. Idempotente: se
 * `completedTasks/` estiver vazia, retorna 0 sem escrever nada. Roda no
 * load da app até a coleção velha ser drenada.
 */
export async function migrateCompletedTasksIntoTasks(uid: string): Promise<number> {
  const completedRef = collection(db, 'users', uid, 'completedTasks');
  const snap = await getDocs(completedRef);
  if (snap.empty) return 0;

  const BATCH_LIMIT = 200;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const slice = docs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const d of slice) {
      const raw = d.data() as Record<string, unknown>;
      const id = d.id;
      const archivedAt = raw.archivedAt ?? raw.completedAt ?? null;
      const archivedFromSectionName =
        (raw.archivedFromSectionName as string | null | undefined) ??
        (raw.completedFromSectionName as string | null | undefined) ??
        null;
      // Limpa campos antigos para não poluir os docs migrados.
      const cleaned = { ...raw };
      delete cleaned.archivedAt;
      delete cleaned.archivedFromSection;
      delete cleaned.archivedFromSectionName;
      batch.set(
        doc(db, 'users', uid, 'tasks', id),
        {
          ...cleaned,
          id,
          checked: true,
          completedAt: archivedAt,
          completedFromSectionName: archivedFromSectionName,
        },
        { merge: true },
      );
      batch.delete(d.ref);
    }
    await batch.commit();
  }
  return docs.length;
}
