import { doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { getDisplayTitle, serializeTitle } from './parser';
import { getChildren } from './taskHierarchy';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
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

/**
 * Cria uma nova tarefa derivada de `source`, copiando os detalhes (moscow,
 * modo, esforço, prazo, projeto, título) — todos editáveis depois. Quando
 * `asChild` é true, a nova tarefa vira filha de `source` (parentId =
 * source.id) e fica oculta das listas; quando false, vira uma tarefa de topo
 * (para servir de pai de `source`). Devolve o doc id da nova tarefa.
 */
async function createDerivedTask(
  uid: string,
  source: Task,
  asChild: boolean,
  displayOverride?: string,
): Promise<string> {
  const taskId = await nextTaskId(uid);
  const today = new Date().toISOString().slice(0, 10);
  const display = displayOverride ?? getDisplayTitle(source.title);
  const created: Task = {
    id: String(taskId),
    taskId,
    title: serializeTitle(display, {
      taskId,
      modo: source.modo,
      moscow: source.moscow,
      esforco: source.esforco,
      deadline: source.deadline,
      addedDate: today,
      dependsOn: [],
    }),
    note: '',
    checked: false,
    inProgress: false,
    moscow: source.moscow,
    modo: source.modo,
    esforco: source.esforco,
    deadline: source.deadline,
    addedDate: today,
    dependsOn: [],
    subtasks: [],
    parentId: asChild ? source.id : null,
    section: source.section,
    completedAt: null,
  };
  await upsertTask(uid, created);
  return String(taskId);
}

/**
 * Cria uma filha de `parent` copiando seus detalhes. Devolve o doc id. Se
 * `displayTitle` for passado, usa-o como título (em vez de copiar o do pai) —
 * útil para gerar várias filhas distintas, ex: pela IA.
 */
export function createChildTask(
  uid: string,
  parent: Task,
  displayTitle?: string,
): Promise<string> {
  return createDerivedTask(uid, parent, true, displayTitle);
}

/**
 * Cria uma nova tarefa de topo copiando os detalhes de `child`, para servir
 * de pai dela. Devolve o doc id; o chamador deve vincular `child.parentId`.
 */
export function createParentTask(uid: string, child: Task): Promise<string> {
  return createDerivedTask(uid, child, false);
}

/** Vincula `task` a um pai existente (ou desvincula com null). */
export async function setTaskParent(
  uid: string,
  task: Task,
  parentId: string | null,
): Promise<void> {
  await patchTask(uid, task, { parentId });
}

/**
 * Promove as filhas diretas de um pai a tarefas de topo (parentId = null).
 * Usado antes de apagar o pai: as filhas voltam à lista principal em vez de
 * serem apagadas junto. Netas permanecem vinculadas às suas próprias mães.
 */
export async function orphanChildren(
  uid: string,
  parentId: string,
  allTasks: Task[],
): Promise<void> {
  const children = getChildren(parentId, allTasks);
  await Promise.all(children.map((c) => patchTask(uid, c, { parentId: null })));
}
