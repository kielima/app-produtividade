import { supabase } from './supabase';
import { rowToTask } from '../repositories/tasksRepo';
import { rowToProject } from '../repositories/projectsRepo';
import { rowToNote } from '../repositories/notesRepo';
import {
  EXPORT_VERSION,
  type ExportPayload,
  type GlickoEntry,
  type MemoryDoc,
} from './exportData';

/**
 * Coleta todos os dados do usuário em um único objeto JSON serializável.
 * Roundtrip-friendly: o schema espelha o que o script `scripts/migrate/`
 * escreve, então o JSON exportado pode ser reimportado por um migrate
 * inverso (não implementado ainda, fora do escopo do M5).
 *
 * Anti-lock-in: roda no client, escreve em disco local — o usuário sai
 * do Supabase sem nada preso na nuvem.
 */

async function fetchMemoryContent(uid: string, namespace: string): Promise<string | null> {
  const { data } = await supabase
    .from('memory_docs')
    .select('content')
    .eq('user_id', uid)
    .eq('namespace', namespace)
    .eq('slug', '')
    .maybeSingle();
  return (data?.content as string | undefined) ?? null;
}

async function fetchMemorySubcollection(uid: string, namespace: string): Promise<MemoryDoc[]> {
  const { data } = await supabase
    .from('memory_docs')
    .select('slug, content')
    .eq('user_id', uid)
    .eq('namespace', namespace)
    .neq('slug', '');
  return (data ?? []).map((row) => ({
    id: row.slug as string,
    content: (row.content as string) ?? '',
  }));
}

async function fetchGlicko(uid: string): Promise<GlickoEntry[]> {
  const { data } = await supabase
    .from('project_ratings')
    .select('project_id, r, rd, sigma')
    .eq('user_id', uid);
  return (data ?? []).map((row) => ({
    id: row.project_id as string,
    r: row.r as number,
    rd: row.rd as number,
    sigma: row.sigma as number,
  }));
}

export async function exportAllData(uid: string): Promise<ExportPayload> {
  const [tasksRes, projectsRes, notesRes, glicko] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', uid),
    supabase.from('projects').select('*').eq('user_id', uid),
    supabase.from('notes').select('*').eq('user_id', uid),
    fetchGlicko(uid),
  ]);

  const [glossary, claude, projectsContext, automations, context] = await Promise.all([
    fetchMemoryContent(uid, 'glossary'),
    fetchMemoryContent(uid, 'claude'),
    fetchMemorySubcollection(uid, 'projects_context'),
    fetchMemorySubcollection(uid, 'automations'),
    fetchMemorySubcollection(uid, 'context'),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    uid,
    version: EXPORT_VERSION,
    // Coleção legada (sections) foi absorvida por `projects` — não existe
    // mais no Postgres, então o export sempre a traz vazia.
    sections: [],
    tasks: (tasksRes.data ?? []).map(rowToTask),
    projects: (projectsRes.data ?? []).map(rowToProject),
    notes: (notesRes.data ?? []).map(rowToNote),
    glicko,
    memory: { glossary, claude, projectsContext, automations, context },
  };
}
