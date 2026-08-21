import { createNote, patchNote } from '../repositories/notesRepo';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
import { serializeTitle } from './parser';
import type { Project, Task } from '../types';

// Helpers reutilizáveis para criar uma nota ou tarefa a partir de texto.
// Extraídos do fluxo "imagem → nota/tarefa" do App para serem compartilhados
// com a conversão de anotações da aba Leitura (marca-texto/comentário/tinta).

// Nome do projeto onde as tarefas criadas sem escolha explícita devem
// aterrissar (ex.: tarefa criada a partir da transcrição do Gemini ao
// compartilhar uma imagem). Mantido em sincronia com
// DEFAULT_CONVERT_PROJECT_NAME em NoteDetailView.tsx.
const DEFAULT_PROJECT_NAME = 'Tarefas sem projeto';

export function pickDefaultProjectId(projects: Project[]): string | null {
  const available = projects.filter(
    (p) => p.status !== 'Concluído' && p.status !== 'Cancelado',
  );
  const preferred = available.find(
    (p) => p.name.trim().toLowerCase() === DEFAULT_PROJECT_NAME.toLowerCase(),
  );
  return preferred?.id ?? available[0]?.id ?? null;
}

// Origem opcional de uma anotação da aba Leitura: guardada na nota/tarefa
// criada para permitir voltar direto ao PDF (ver `useReadingNavigation`).
export interface TextSource {
  itemId: string;
  annotationId: string;
}

// Cria uma nota com título e corpo. Retorna o id da nota criada.
export async function createNoteFromText(
  uid: string,
  title: string,
  text: string,
  source?: TextSource,
): Promise<string> {
  const note = await createNote(uid);
  await patchNote(uid, note.id, {
    title,
    note: text,
    ...(source ? { sourceItemId: source.itemId, sourceAnnotationId: source.annotationId } : {}),
  });
  return note.id;
}

// Cria uma tarefa no primeiro projeto ativo. Retorna o id da tarefa, ou null
// se não houver projeto disponível para recebê-la.
export async function createTaskFromText(
  uid: string,
  projects: Project[],
  title: string,
  text: string,
  source?: TextSource,
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
    section: sectionId,
    completedAt: null,
    ...(source ? { sourceItemId: source.itemId, sourceAnnotationId: source.annotationId } : {}),
  };
  await upsertTask(uid, newTask);
  return String(taskId);
}
