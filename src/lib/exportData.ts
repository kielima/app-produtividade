import type { Note, Project, Section, Task } from '../types';
import type { GlickoRating } from './glicko2';

export const EXPORT_VERSION = 3;

export interface MemoryDoc {
  id: string;
  content: string;
}

export interface GlickoEntry extends GlickoRating {
  id: string;
}

// v3: tarefas ativas e concluídas vivem todas em `tasks` — distintas pelo
// campo `checked` e por `completedAt`. v2 e anteriores tinham um array
// separado `completedTasks` que o parser de import absorve em `tasks`.
export interface ExportPayload {
  exportedAt: string;
  uid: string;
  version: number;
  sections: Section[];
  tasks: Task[];
  projects: Project[];
  notes: Note[];
  glicko: GlickoEntry[];
  memory: {
    glossary: string | null;
    claude: string | null;
    projectsContext: MemoryDoc[];
    automations: MemoryDoc[];
    context: MemoryDoc[];
  };
}

/**
 * Helper de DOM: serializa o payload, cria um Blob com `application/json`
 * e dispara o download via <a download>. Não toca em estado React.
 */
export function downloadJson(payload: ExportPayload, filename?: string): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename(payload);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function defaultFilename(payload: ExportPayload): string {
  const date = payload.exportedAt.slice(0, 10);
  return `app-produtividade-export-${date}.json`;
}

/**
 * Resumo compacto pro UI exibir antes do download.
 */
export function summarize(payload: ExportPayload): Record<string, number> {
  return {
    sections: payload.sections.length,
    tasks: payload.tasks.length,
    projects: payload.projects.length,
    notes: payload.notes.length,
    glicko: payload.glicko.length,
    memoryProjects: payload.memory.projectsContext.length,
    memoryAutomations: payload.memory.automations.length,
    memoryContext: payload.memory.context.length,
  };
}
