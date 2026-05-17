import {
  collection,
  doc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Project } from '../types';

/**
 * Mescla cada doc em users/{uid}/sections em users/{uid}/projects:
 * sections e projects passaram a ser a mesma entidade. Se um projeto com
 * o mesmo id já existe, só completa order vindo da seção sem sobrescrever
 * os outros campos. Roda toda vez que o useUserData monta, mas só faz
 * trabalho se a coleção sections tiver docs — é idempotente.
 */
export async function migrateSectionsToProjects(uid: string): Promise<number> {
  const sectionsSnap = await getDocs(collection(db, 'users', uid, 'sections'));
  if (sectionsSnap.empty) return 0;

  const projectsSnap = await getDocs(collection(db, 'users', uid, 'projects'));
  const existingProjects = new Map<string, Project>();
  for (const d of projectsSnap.docs) {
    existingProjects.set(d.id, { ...(d.data() as Omit<Project, 'id'>), id: d.id });
  }

  const batch = writeBatch(db);
  let migrated = 0;
  let cursor = 0;
  for (const d of sectionsSnap.docs) {
    const section = d.data() as {
      name?: string;
      order?: number;
    };
    const id = d.id;
    const ref = doc(db, 'users', uid, 'projects', id);
    const existing = existingProjects.get(id);

    if (existing) {
      // Projeto já existe — só completa order se estiver vazio.
      const patch: Partial<Project> = {};
      if (existing.order == null && section.order != null) patch.order = section.order;
      if (Object.keys(patch).length > 0) {
        batch.set(ref, patch, { merge: true });
        migrated++;
      }
    } else {
      const newProject: Project = {
        id,
        name: section.name ?? id,
        area: '',
        status: 'A iniciar',
        priority: '',
        objective: '',
        currentStatus: '',
        nextSteps: '',
        deadline: '',
        estimatedDuration: '',
        dependsOn: '',
        notes: '',
        order: section.order ?? cursor,
      };
      batch.set(ref, newProject);
      migrated++;
    }
    cursor++;
  }
  if (migrated > 0) await batch.commit();
  return migrated;
}
