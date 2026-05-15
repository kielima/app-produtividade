import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { taskSectionId } from '../lib/parser';
import type { MoSCoW, Section, Task } from '../types';

function sectionsCol(uid: string) {
  return collection(db, 'users', uid, 'sections');
}

export function subscribeToSections(
  uid: string,
  cb: (sections: Section[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    sectionsCol(uid),
    (snap) => {
      const sections: Section[] = snap.docs.map((d) => {
        const data = d.data() as Omit<Section, 'id'>;
        return { ...data, id: d.id };
      });
      sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
      cb(sections);
    },
    (err) => onError?.(err),
  );
}

export async function upsertSection(uid: string, section: Section): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'sections', section.id), section, { merge: true });
}

/**
 * Cria seção com slug determinístico. Se a seção já existe, faz upsert.
 * Devolve o objeto resultante (com id).
 */
export async function createSection(
  uid: string,
  name: string,
  moscow: MoSCoW = '',
  order = 0,
): Promise<Section> {
  const id = taskSectionId(name);
  const section: Section = { id, name, moscow, order };
  await upsertSection(uid, section);
  return section;
}

export async function setSectionMoscow(
  uid: string,
  sectionId: string,
  moscow: MoSCoW,
): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'sections', sectionId), { moscow }, { merge: true });
}

export async function renameSection(
  uid: string,
  oldId: string,
  newName: string,
): Promise<string> {
  const newId = taskSectionId(newName);
  if (newId === oldId) {
    await setDoc(doc(db, 'users', uid, 'sections', oldId), { name: newName }, { merge: true });
    return oldId;
  }

  // Slug mudou → criar novo doc, repor tarefas, deletar antigo.
  // Lê seção atual + tarefas dela
  const oldRef = doc(db, 'users', uid, 'sections', oldId);
  const tasksSnap = await getDocs(collection(db, 'users', uid, 'tasks'));
  const affected: Task[] = [];
  tasksSnap.forEach((d) => {
    const t = { ...(d.data() as Omit<Task, 'id'>), id: d.id } as Task;
    if (t.section === oldId) affected.push(t);
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'sections', newId), { id: newId, name: newName }, { merge: true });
  for (const t of affected) {
    batch.set(doc(db, 'users', uid, 'tasks', t.id), { section: newId }, { merge: true });
  }
  batch.delete(oldRef);
  await batch.commit();
  return newId;
}

/**
 * Deleta a seção e todas as tarefas pertencentes a ela. Confirmação fica
 * a cargo do componente que chama.
 */
export async function deleteSection(uid: string, sectionId: string): Promise<number> {
  const tasksSnap = await getDocs(collection(db, 'users', uid, 'tasks'));
  let deletedTasks = 0;
  const batches: ReturnType<typeof writeBatch>[] = [];
  let batch = writeBatch(db);
  let opsInBatch = 0;
  const flush = () => {
    if (opsInBatch > 0) {
      batches.push(batch);
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  };

  tasksSnap.forEach((d) => {
    const t = d.data() as Task;
    if (t.section === sectionId) {
      batch.delete(doc(db, 'users', uid, 'tasks', d.id));
      opsInBatch++;
      deletedTasks++;
      if (opsInBatch >= 450) flush();
    }
  });
  batch.delete(doc(db, 'users', uid, 'sections', sectionId));
  opsInBatch++;
  flush();

  for (const b of batches) await b.commit();
  return deletedTasks;
}
