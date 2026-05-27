import { doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
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
  // Saneia `modo` — docs antigos podem vir com valor ausente/inválido e
  // sem isso `serializeTitle` produziria `[undefined]` no título.
  if (merged.modo !== 'manual' && merged.modo !== 'colaborar' && merged.modo !== 'delegar') {
    merged.modo = 'manual';
  }
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

  // Sincroniza `completedAt`/`completedFromSectionName` com a transição
  // de `checked`. Snapshot do nome do projeto é gravado no momento da
  // conclusão para sobreviver a uma deleção futura do projeto.
  const isCompleting = patch.checked === true && task.checked !== true;
  const isReopening = patch.checked === false && task.checked === true;
  if (isCompleting) {
    let projectName: string | null = null;
    if (merged.section) {
      try {
        const psnap = await getDoc(doc(db, 'users', uid, 'projects', merged.section));
        if (psnap.exists()) {
          const data = psnap.data() as { name?: string };
          projectName = data.name ?? null;
        }
      } catch {
        // snapshot do nome é best-effort
      }
    }
    // serverTimestamp() é um sentinel — escapa do tipo Task aqui de propósito.
    (merged as unknown as { completedAt: unknown }).completedAt = serverTimestamp();
    merged.completedFromSectionName = projectName;
  } else if (isReopening) {
    merged.completedAt = null;
    merged.completedFromSectionName = null;
  }

  await upsertTask(uid, merged);
  return merged;
}
