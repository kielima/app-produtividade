import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { taskSectionId } from '../lib/parser';
import type { Project } from '../types';

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
        const data = d.data() as Omit<Project, 'id'>;
        return { ...data, id: d.id };
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

export async function deleteProject(uid: string, projectId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'projects', projectId));
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
    order,
  };
  await upsertProject(uid, project);
  return project;
}
