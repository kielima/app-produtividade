import { supabase } from './supabase';
import { taskToRow } from '../repositories/tasksRepo';
import { projectToRow } from '../repositories/projectsRepo';
import { noteToRow } from '../repositories/notesRepo';
import type { ExportPayload, MemoryDoc } from './exportData';
import type { ImportMode } from './importData';

const CHUNK_SIZE = 500;

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

async function deleteAllRows(table: string, uid: string): Promise<number> {
  const { count, error: countErr } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', uid);
  if (countErr) throw new Error(countErr.message);
  if (count) {
    const { error } = await supabase.from(table).delete().eq('user_id', uid);
    if (error) throw new Error(error.message);
  }
  return count ?? 0;
}

async function upsertRows(table: string, rows: unknown[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const slice = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from(table).upsert(slice);
    if (error) throw new Error(error.message);
    count += slice.length;
  }
  return count;
}

async function writeMemoryDoc(
  uid: string,
  namespace: string,
  content: string | null,
  mode: ImportMode,
): Promise<boolean> {
  if (content === null) {
    if (mode === 'replace') {
      const { error } = await supabase
        .from('memory_docs')
        .delete()
        .eq('user_id', uid)
        .eq('namespace', namespace)
        .eq('slug', '');
      if (error) throw new Error(error.message);
    }
    return false;
  }
  const { error } = await supabase
    .from('memory_docs')
    .upsert(
      { user_id: uid, namespace, slug: '', content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,namespace,slug' },
    );
  if (error) throw new Error(error.message);
  return true;
}

async function writeMemorySub(
  uid: string,
  namespace: string,
  docs: MemoryDoc[],
  mode: ImportMode,
  stats: ImportStats,
): Promise<number> {
  if (mode === 'replace') {
    const { count } = await supabase
      .from('memory_docs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('namespace', namespace)
      .neq('slug', '');
    if (count) {
      const { error } = await supabase
        .from('memory_docs')
        .delete()
        .eq('user_id', uid)
        .eq('namespace', namespace)
        .neq('slug', '');
      if (error) throw new Error(error.message);
    }
    stats.deleted += count ?? 0;
  }
  const rows = docs.map((d) => ({
    user_id: uid,
    namespace,
    slug: d.id,
    content: d.content,
    updated_at: new Date().toISOString(),
  }));
  return upsertRows('memory_docs', rows);
}

/**
 * Escreve o payload no Supabase, sob as linhas do usuário (`user_id = uid`).
 *
 * - mode='merge': sobrescreve linhas com mesmo id; deixa o resto intocado.
 * - mode='replace': apaga todas as linhas do usuário antes de escrever.
 *
 * Em ambos os modos, cada linha escrita é substituída por inteiro (upsert
 * com todas as colunas) — o JSON é a fonte de verdade pra linha.
 */
export async function importAllData(
  uid: string,
  payload: ExportPayload,
  mode: ImportMode,
): Promise<ImportStats> {
  const stats = emptyStats();

  if (mode === 'replace') {
    // Ordem: tasks/notes antes de projects (FKs project_id apontam pra
    // projects) — deletar projects primeiro deixaria o FK íntegro de qualquer
    // forma (on delete set null), mas a ordem abaixo evita updates implícitos.
    stats.deleted += await deleteAllRows('tasks', uid);
    stats.deleted += await deleteAllRows('notes', uid);
    stats.deleted += await deleteAllRows('project_ratings', uid);
    stats.deleted += await deleteAllRows('projects', uid);
  }

  // sections não existe mais como tabela própria (absorvida por projects há
  // muito tempo) — o campo do payload é só compatibilidade com exports v2.
  stats.sections = 0;

  stats.projects = await upsertRows(
    'projects',
    payload.projects.map((p) => projectToRow(uid, p)),
  );
  stats.tasks = await upsertRows(
    'tasks',
    payload.tasks.map((t) => taskToRow(uid, t)),
  );
  stats.notes = await upsertRows(
    'notes',
    payload.notes.map((n) => noteToRow(uid, n)),
  );
  stats.glicko = await upsertRows(
    'project_ratings',
    payload.glicko.map((g) => ({ project_id: g.id, user_id: uid, r: g.r, rd: g.rd, sigma: g.sigma })),
  );

  stats.glossary = await writeMemoryDoc(uid, 'glossary', payload.memory.glossary, mode);
  stats.claude = await writeMemoryDoc(uid, 'claude', payload.memory.claude, mode);

  stats.memoryProjects = await writeMemorySub(
    uid,
    'projects_context',
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
  stats.memoryContext = await writeMemorySub(uid, 'context', payload.memory.context, mode, stats);

  return stats;
}
