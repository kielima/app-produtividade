import { supabase } from '../lib/supabase';
import { taskSectionId } from '../lib/parser';
import { normalizeTags } from '../lib/tags';
import { subscribeTable, type Unsubscribe } from './realtimeTable';
import type { Project } from '../types';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  area: string | null;
  categories: string[] | null;
  status: string | null;
  priority: string | null;
  moscow: string | null;
  objective: string | null;
  current_status: string | null;
  next_steps: string | null;
  deadline: string | null;
  estimated_duration: string | null;
  depends_on: string | null;
  notes: string | null;
  order: number | null;
  status_before_block: string | null;
}

export function rowToProject(row: ProjectRow): Project {
  const merged: Project = {
    id: row.id,
    name: row.name ?? '',
    area: row.area ?? '',
    categories: normalizeTags(row.categories ?? []),
    status: (row.status as Project['status']) || 'A iniciar',
    priority: (row.priority as Project['priority']) ?? '',
    moscow: (row.moscow as Project['moscow']) || 'wont',
    objective: row.objective ?? '',
    currentStatus: row.current_status ?? '',
    nextSteps: row.next_steps ?? '',
    deadline: row.deadline ?? '',
    estimatedDuration: row.estimated_duration ?? '',
    dependsOn: row.depends_on ?? null,
    notes: row.notes ?? '',
    ...(row.order != null ? { order: row.order } : {}),
    ...(row.status_before_block ? { statusBeforeBlock: row.status_before_block as Project['status'] } : {}),
  };
  return merged;
}

export function projectToRow(uid: string, project: Project): ProjectRow {
  return {
    id: project.id,
    user_id: uid,
    name: project.name,
    area: project.area,
    categories: project.categories,
    status: project.status,
    priority: project.priority,
    moscow: project.moscow,
    objective: project.objective,
    current_status: project.currentStatus,
    next_steps: project.nextSteps,
    deadline: project.deadline,
    estimated_duration: project.estimatedDuration,
    depends_on: project.dependsOn || null,
    notes: project.notes,
    order: project.order ?? null,
    status_before_block: project.statusBeforeBlock ?? null,
  };
}

export function subscribeToProjects(
  uid: string,
  cb: (projects: Project[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<ProjectRow, Project>(
    { table: 'projects', uid, mapRow: rowToProject, idOf: (p) => p.id, onError },
    (projects) => {
      projects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
      cb(projects);
    },
  );
}

export async function upsertProject(uid: string, project: Project): Promise<void> {
  const { error } = await supabase.from('projects').upsert(projectToRow(uid, project));
  if (error) throw new Error(error.message);
}

export async function patchProject(
  uid: string,
  projectId: string,
  patch: Partial<Project>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.area !== undefined) row.area = patch.area;
  if (patch.categories !== undefined) row.categories = patch.categories;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.moscow !== undefined) row.moscow = patch.moscow;
  if (patch.objective !== undefined) row.objective = patch.objective;
  if (patch.currentStatus !== undefined) row.current_status = patch.currentStatus;
  if (patch.nextSteps !== undefined) row.next_steps = patch.nextSteps;
  if (patch.deadline !== undefined) row.deadline = patch.deadline;
  if (patch.estimatedDuration !== undefined) row.estimated_duration = patch.estimatedDuration;
  if (patch.dependsOn !== undefined) row.depends_on = patch.dependsOn || null;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.order !== undefined) row.order = patch.order;
  if (patch.statusBeforeBlock !== undefined) row.status_before_block = patch.statusBeforeBlock;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('projects').update(row).eq('user_id', uid).eq('id', projectId);
  if (error) throw new Error(error.message);
}

export async function deleteProject(uid: string, projectId: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('user_id', uid).eq('id', projectId);
  if (error) throw new Error(error.message);
}

/**
 * Reescreve o campo `order` dos projetos na sequência informada.
 */
export async function reorderProjects(uid: string, orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('projects').update({ order: idx }).eq('user_id', uid).eq('id', id),
    ),
  );
}

/**
 * Apaga o projeto e todas as tarefas pertencentes a ele
 * (task.section === projectId).
 */
export async function deleteProjectWithTasks(uid: string, projectId: string): Promise<number> {
  const { data, error: countErr } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', uid)
    .eq('project_id', projectId);
  if (countErr) throw new Error(countErr.message);
  const deletedTasks = data?.length ?? 0;

  const { error: delTasksErr } = await supabase
    .from('tasks')
    .delete()
    .eq('user_id', uid)
    .eq('project_id', projectId);
  if (delTasksErr) throw new Error(delTasksErr.message);

  const { error: delProjectErr } = await supabase
    .from('projects')
    .delete()
    .eq('user_id', uid)
    .eq('id', projectId);
  if (delProjectErr) throw new Error(delProjectErr.message);

  return deletedTasks;
}

export async function createProject(uid: string, name: string, order = 0): Promise<Project> {
  let baseId = taskSectionId(name);
  if (!baseId) baseId = `proj-${Date.now()}`;
  let id = baseId;
  const { data: existingRows } = await supabase.from('projects').select('id').eq('user_id', uid);
  const existing = new Set((existingRows ?? []).map((r) => r.id as string));
  if (existing.has(id)) {
    let n = 2;
    while (existing.has(`${baseId}-${n}`)) n++;
    id = `${baseId}-${n}`;
  }
  const project: Project = {
    id,
    name,
    area: '',
    categories: [],
    status: 'A iniciar',
    priority: '',
    moscow: 'wont',
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
