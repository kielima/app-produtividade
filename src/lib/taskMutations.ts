import { getDisplayTitle, serializeTitle } from './parser';
import { upsertTask } from '../repositories/tasksRepo';
import type { Task } from '../types';

/**
 * Aplica patch parcial num Task, reconstrói o `title` raw com as tags
 * resultantes e grava no Firestore.
 *
 * Use sempre esta função pra mutações de tasks. Garante que `task.title`
 * permaneça sincronizado com os campos estruturados (taskId, moscow,
 * modo, esforco, deadline, addedDate, dependsOn).
 *
 * O `displayOverride` é opcional: se passado, troca o título visível
 * (uso típico: edit inline do título). Se omitido, preserva o display
 * atual extraído de `task.title`.
 */
export async function patchTask(
  uid: string,
  task: Task,
  patch: Partial<Task>,
  displayOverride?: string,
): Promise<Task> {
  const merged: Task = { ...task, ...patch };
  const display = displayOverride ?? getDisplayTitle(task.title);
  merged.title = serializeTitle(display, {
    taskId: merged.taskId,
    modo: merged.modo,
    moscow: merged.moscow,
    esforco: merged.esforco,
    deadline: merged.deadline,
    addedDate: merged.addedDate,
    dependsOn: merged.dependsOn,
  });
  await upsertTask(uid, merged);
  return merged;
}
