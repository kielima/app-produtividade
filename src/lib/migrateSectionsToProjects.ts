import {
  collection,
  doc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Project } from '../types';

/**
 * Mescla cada doc em users/{uid}/sections em users/{uid}/projects e apaga a
 * seção legada na sequência. Sem o delete, deletar um projeto faria ele
 * ressuscitar no próximo mount, porque a seção legada continuaria recriando
 * o projeto. Se o usuário já tem ao menos um projeto, assume que a migração
 * inicial já rodou e não ressuscita projetos ausentes — só limpa a coleção
 * legada.
 */
export async function migrateSectionsToProjects(uid: string): Promise<number> {
  const sectionsSnap = await getDocs(collection(db, 'users', uid, 'sections'));
  if (sectionsSnap.empty) return 0;

  const projectsSnap = await getDocs(collection(db, 'users', uid, 'projects'));
  const existingProjects = new Map<string, Project>();
  for (const d of projectsSnap.docs) {
    existingProjects.set(d.id, { ...(d.data() as Omit<Project, 'id'>), id: d.id });
  }
  const alreadyMigrated = existingProjects.size > 0;

  const batch = writeBatch(db);
  let migrated = 0;
  let cursor = 0;
  for (const d of sectionsSnap.docs) {
    const section = d.data() as {
      name?: string;
      order?: number;
    };
    const id = d.id;
    const sectionRef = doc(db, 'users', uid, 'sections', id);
    const projectRef = doc(db, 'users', uid, 'projects', id);
    const existing = existingProjects.get(id);

    if (existing) {
      const patch: Partial<Project> = {};
      if (existing.order == null && section.order != null) patch.order = section.order;
      if (Object.keys(patch).length > 0) {
        batch.set(projectRef, patch, { merge: true });
        migrated++;
      }
    } else if (!alreadyMigrated) {
      const newProject: Project = {
        id,
        name: section.name ?? id,
        area: '',
        category: '',
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
      batch.set(projectRef, newProject);
      migrated++;
    }
    batch.delete(sectionRef);
    cursor++;
  }
  await batch.commit();
  return migrated;
}
