import { EXPORT_VERSION, type ExportPayload, type MemoryDoc } from './exportData';
import type { Project, Section, Task } from '../types';

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportParseError';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertArray(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new ImportParseError(`Campo "${label}" precisa ser um array.`);
  }
  return v;
}

function assertString(v: unknown, label: string): string {
  if (typeof v !== 'string') {
    throw new ImportParseError(`Campo "${label}" precisa ser string.`);
  }
  return v;
}

function assertStringOrNull(v: unknown, label: string): string | null {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  throw new ImportParseError(`Campo "${label}" precisa ser string ou null.`);
}

function parseMemoryDocs(v: unknown, label: string): MemoryDoc[] {
  const arr = assertArray(v, label);
  return arr.map((item, i) => {
    if (!isObject(item)) {
      throw new ImportParseError(`"${label}[${i}]" precisa ser objeto.`);
    }
    return {
      id: assertString(item.id, `${label}[${i}].id`),
      content: assertString(item.content, `${label}[${i}].content`),
    };
  });
}

/**
 * Parseia o texto bruto do arquivo e valida o formato. Não escreve nada —
 * só garante que o payload tem a forma esperada por `importAllData`.
 * Lança `ImportParseError` com mensagem em pt-BR pra mostrar no UI.
 */
export function parseImportPayload(text: string): ExportPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ImportParseError(`JSON inválido: ${msg}`);
  }

  if (!isObject(raw)) {
    throw new ImportParseError('JSON precisa ser um objeto na raiz.');
  }

  const version = raw.version;
  if (typeof version !== 'number') {
    throw new ImportParseError('Campo "version" precisa ser número.');
  }
  if (version > EXPORT_VERSION) {
    throw new ImportParseError(
      `Versão ${version} é mais nova que a suportada (${EXPORT_VERSION}). Atualize o app.`,
    );
  }

  const memory = raw.memory;
  if (!isObject(memory)) {
    throw new ImportParseError('Campo "memory" precisa ser objeto.');
  }

  return {
    exportedAt: assertString(raw.exportedAt, 'exportedAt'),
    uid: assertString(raw.uid, 'uid'),
    version,
    sections: assertArray(raw.sections, 'sections') as Section[],
    tasks: assertArray(raw.tasks, 'tasks') as Task[],
    completedTasks: assertArray(raw.completedTasks, 'completedTasks') as Task[],
    projects: assertArray(raw.projects, 'projects') as Project[],
    memory: {
      glossary: assertStringOrNull(memory.glossary, 'memory.glossary'),
      claude: assertStringOrNull(memory.claude, 'memory.claude'),
      projectsContext: parseMemoryDocs(memory.projectsContext, 'memory.projectsContext'),
      automations: parseMemoryDocs(memory.automations, 'memory.automations'),
      context: parseMemoryDocs(memory.context, 'memory.context'),
    },
  };
}

export type ImportMode = 'merge' | 'replace';
