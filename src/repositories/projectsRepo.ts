import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { taskSectionId } from '../lib/parser';
import type { MoSCoW, Project, Task } from '../types';

function projectsCol(uid: string) {
  return collection(db, 'users', uid, 'projects');
}

export function subscribeToProjects(
  uid: string,
  cb: (projects: Project[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    projectsCol(uid),
    (snap) => {
      const projects: Project[] = snap.docs.map((d) => {
        const data = d.data() as Partial<Omit<Project, 'id'>>;
        return {
          name: '',
          area: '',
          status: '',
          priority: '',
          objective: '',
          currentStatus: '',
          nextSteps: '',
          deadline: '',
          estimatedDuration: '',
          dependsOn: '',
          notes: '',
          moscow: '',
          ...data,
          id: d.id,
        } as Project;
      });
      projects.sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
      );
      cb(projects);
    },
    (err) => onError?.(err),
  );
}

export async function upsertProject(uid: string, project: Project): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'projects', project.id), project, { merge: true });
}

export async function patchProject(
  uid: string,
  projectId: string,
  patch: Partial<Project>,
): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'projects', projectId), patch, { merge: true });
}

export async function setProjectMoscow(
  uid: string,
  projectId: string,
  moscow: MoSCoW,
): Promise<void> {
  await patchProject(uid, projectId, { moscow });
}

export async function deleteProject(uid: string, projectId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'projects', projectId));
}

/**
 * Reescreve o campo `order` dos projetos na sequência informada.
 * Usa um batch só (até 500 ops cabem tranquilamente no limite do Firestore).
 */
export async function reorderProjects(
  uid: string,
  orderedIds: string[],
): Promise<void> {
  const batch = writeBatch(db);
  orderedIds.forEach((id, idx) => {
    batch.set(doc(db, 'users', uid, 'projects', id), { order: idx }, { merge: true });
  });
  await batch.commit();
}

/**
 * Apaga o projeto e todas as tarefas pertencentes a ele
 * (task.section === projectId). Substitui o antigo deleteSection.
 */
export async function deleteProjectWithTasks(
  uid: string,
  projectId: string,
): Promise<number> {
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
    if (t.section === projectId) {
      batch.delete(doc(db, 'users', uid, 'tasks', d.id));
      opsInBatch++;
      deletedTasks++;
      if (opsInBatch >= 450) flush();
    }
  });
  batch.delete(doc(db, 'users', uid, 'projects', projectId));
  opsInBatch++;
  flush();

  for (const b of batches) await b.commit();
  return deletedTasks;
}

export async function createProject(
  uid: string,
  name: string,
  order = 0,
): Promise<Project> {
  let baseId = taskSectionId(name);
  if (!baseId) baseId = `proj-${Date.now()}`;
  let id = baseId;
  // Garante slug único — se já existe, sufixa.
  const snap = await getDocs(projectsCol(uid));
  const existing = new Set(snap.docs.map((d) => d.id));
  if (existing.has(id)) {
    let n = 2;
    while (existing.has(`${baseId}-${n}`)) n++;
    id = `${baseId}-${n}`;
  }
  const project: Project = {
    id,
    name,
    area: '',
    status: '',
    priority: '',
    objective: '',
    currentStatus: '',
    nextSteps: '',
    deadline: '',
    estimatedDuration: '',
    dependsOn: '',
    notes: '',
    moscow: '',
    order,
  };
  await upsertProject(uid, project);
  return project;
}
