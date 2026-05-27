import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from './firebase';
import type { ExportPayload, MemoryDoc } from './exportData';
import type { ImportMode } from './importData';

const BATCH_LIMIT = 450;

export interface ImportStats {
  sections: number;
  tasks: number;
  projects: number;
  notes: number;
  glicko: number;
  memoryProjects: number;
  memoryAutomations: number;
  memoryContext: number;
  glossary: boolean;
  claude: boolean;
  deleted: number;
}

function emptyStats(): ImportStats {
  return {
    sections: 0,
    tasks: 0,
    projects: 0,
    notes: 0,
    glicko: 0,
    memoryProjects: 0,
    memoryAutomations: 0,
    memoryContext: 0,
    glossary: false,
    claude: false,
    deleted: 0,
  };
}

async function deleteAllDocs(ref: CollectionReference): Promise<number> {
  const snap = await getDocs(ref);
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const slice = snap.docs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    slice.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}

async function writeDocs<T extends { id: string }>(
  ref: CollectionReference,
  items: T[],
): Promise<number> {
  let count = 0;
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const slice = items.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    slice.forEach((item) => batch.set(doc(ref, item.id), item));
    await batch.commit();
    count += slice.length;
  }
  return count;
}

async function writeMemoryDoc(
  ref: DocumentReference,
  content: string | null,
  mode: ImportMode,
): Promise<boolean> {
  if (content === null) {
    if (mode === 'replace') {
      const batch = writeBatch(db);
      batch.delete(ref);
      await batch.commit();
    }
    return false;
  }
  const batch = writeBatch(db);
  batch.set(ref, { content, updatedAt: new Date() });
  await batch.commit();
  return true;
}

async function writeMemorySub(
  uid: string,
  subcoll: string,
  docs: MemoryDoc[],
  mode: ImportMode,
  stats: ImportStats,
): Promise<number> {
  const ref = collection(db, 'users', uid, 'memory', subcoll, 'docs');
  if (mode === 'replace') {
    stats.deleted += await deleteAllDocs(ref);
  }
  let count = 0;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const slice = docs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    slice.forEach((d) => {
      batch.set(doc(ref, d.id), { content: d.content, updatedAt: new Date() });
    });
    await batch.commit();
    count += slice.length;
  }
  return count;
}

/**
 * Escreve o payload no Firestore sob /users/{uid}/.
 *
 * - mode='merge': sobrescreve docs com mesmo id; deixa o resto intocado.
 * - mode='replace': apaga todas as coleções do usuário antes de escrever.
 *
 * Em ambos os modos, cada documento escrito é substituído por inteiro
 * (não merge de campos) — o JSON é a fonte de verdade pro doc.
 */
export async function importAllData(
  uid: string,
  payload: ExportPayload,
  mode: ImportMode,
): Promise<ImportStats> {
  const stats = emptyStats();

  const sectionsRef = collection(db, 'users', uid, 'sections');
  const tasksRef = collection(db, 'users', uid, 'tasks');
  // Legado: até v2 existia uma coleção separada `completedTasks/`. Em
  // modo replace, esvazia ela também para não deixar lixo pra trás.
  const legacyCompletedRef = collection(db, 'users', uid, 'completedTasks');
  const projectsRef = collection(db, 'users', uid, 'projects');
  const notesRef = collection(db, 'users', uid, 'notes');
  const glickoRef = collection(db, 'users', uid, 'glicko');

  if (mode === 'replace') {
    stats.deleted += await deleteAllDocs(sectionsRef);
    stats.deleted += await deleteAllDocs(tasksRef);
    stats.deleted += await deleteAllDocs(legacyCompletedRef);
    stats.deleted += await deleteAllDocs(projectsRef);
    stats.deleted += await deleteAllDocs(notesRef);
    stats.deleted += await deleteAllDocs(glickoRef);
  }

  stats.sections = await writeDocs(sectionsRef, payload.sections);
  stats.tasks = await writeDocs(tasksRef, payload.tasks);
  stats.projects = await writeDocs(projectsRef, payload.projects);
  stats.notes = await writeDocs(notesRef, payload.notes);
  stats.glicko = await writeDocs(glickoRef, payload.glicko);

  stats.glossary = await writeMemoryDoc(
    doc(db, 'users', uid, 'memory', 'glossary'),
    payload.memory.glossary,
    mode,
  );
  stats.claude = await writeMemoryDoc(
    doc(db, 'users', uid, 'memory', 'claude'),
    payload.memory.claude,
    mode,
  );

  stats.memoryProjects = await writeMemorySub(
    uid,
    'projectsContext',
    payload.memory.projectsContext,
    mode,
    stats,
  );
  stats.memoryAutomations = await writeMemorySub(
    uid,
    'automations',
    payload.memory.automations,
    mode,
    stats,
  );
  stats.memoryContext = await writeMemorySub(
    uid,
    'context',
    payload.memory.context,
    mode,
    stats,
  );

  return stats;
}
