import { createNote, patchNote } from '../repositories/notesRepo';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
import { serializeTitle } from './parser';
import type { Project, Task } from '../types';

// Helpers reutilizáveis para criar uma nota ou tarefa a partir de texto.
// Extraídos do fluxo "imagem → nota/tarefa" do App para serem compartilhados
// com a conversão de anotações da aba Leitura (marca-texto/comentário/tinta).

export function pickDefaultProjectId(projects: Project[]): string | null {
  const available = projects.filter(
    (p) => p.status !== 'Concluído' && p.status !== 'Cancelado',
  );
  return available[0]?.id ?? null;
}

// Cria uma nota com título e corpo. Retorna o id da nota criada.
export async function createNoteFromText(
  uid: string,
  title: string,
  text: string,
): Promise<string> {
  const note = await createNote(uid);
  await patchNote(uid, note.id, { title, note: text });
  return note.id;
}

// Cria uma tarefa no primeiro projeto ativo. Retorna o id da tarefa, ou null
// se não houver projeto disponível para recebê-la.
export async function createTaskFromText(
  uid: string,
  projects: Project[],
  title: string,
  text: string,
): Promise<string | null> {
  const sectionId = pickDefaultProjectId(projects);
  if (!sectionId) return null;
  const taskId = await nextTaskId(uid);
  const today = new Date().toISOString().slice(0, 10);
  const newTask: Task = {
    id: String(taskId),
    taskId,
    title: serializeTitle(title || '(sem título)', {
      taskId,
      modo: 'manual',
      moscow: '',
      esforco: '',
      deadline: '',
      addedDate: today,
      dependsOn: [],
    }),
    note: text,
    checked: false,
    inProgress: false,
    moscow: '',
    modo: 'manual',
    esforco: '',
    deadline: '',
    addedDate: today,
    dependsOn: [],
    subtasks: [],
    section: sectionId,
    completedAt: null,
  };
  await upsertTask(uid, newTask);
  return String(taskId);
}
