import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { EXPORT_VERSION, type ExportPayload, type MemoryDoc } from './exportData';
import type { Project, Section, Task } from '../types';

async function fetchCollection<T>(uid: string, path: string): Promise<T[]> {
  const snap = await getDocs(collection(db, 'users', uid, ...path.split('/')));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T);
}

async function fetchDocContent(uid: string, ...pathSegs: string[]): Promise<string | null> {
  const ref = doc(db, 'users', uid, ...pathSegs);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as { content?: string };
  return data.content ?? null;
}

async function fetchMemorySubcollection(uid: string, subcoll: string): Promise<MemoryDoc[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'memory', subcoll, 'docs'));
  return snap.docs.map((d) => {
    const data = d.data() as { content?: string };
    return { id: d.id, content: data.content ?? '' };
  });
}

/**
 * Coleta todos os dados do usuário em um único objeto JSON serializável.
 * Roundtrip-friendly: o schema espelha o que o script `scripts/migrate/`
 * escreve, então o JSON exportado pode ser reimportado por um migrate
 * inverso (não implementado ainda, fora do escopo do M5).
 *
 * Anti-lock-in: roda no client, escreve em disco local — o usuário sai
 * do Firebase sem nada preso na nuvem.
 */
export async function exportAllData(uid: string): Promise<ExportPayload> {
  const [sections, tasks, completedTasks, projects] = await Promise.all([
    fetchCollection<Section>(uid, 'sections'),
    fetchCollection<Task>(uid, 'tasks'),
    fetchCollection<Task>(uid, 'completedTasks'),
    fetchCollection<Project>(uid, 'projects'),
  ]);

  const [glossary, claude, projectsContext, automations, context] = await Promise.all([
    fetchDocContent(uid, 'memory', 'glossary'),
    fetchDocContent(uid, 'memory', 'claude'),
    fetchMemorySubcollection(uid, 'projectsContext'),
    fetchMemorySubcollection(uid, 'automations'),
    fetchMemorySubcollection(uid, 'context'),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    uid,
    version: EXPORT_VERSION,
    sections,
    tasks,
    completedTasks,
    projects,
    memory: { glossary, claude, projectsContext, automations, context },
  };
}
