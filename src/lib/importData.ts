import {
  EXPORT_VERSION,
  type ExportPayload,
  type GlickoEntry,
  type MemoryDoc,
} from './exportData';
import type { Note, Project, Section, Task } from '../types';

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

function assertNumber(v: unknown, label: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new ImportParseError(`Campo "${label}" precisa ser número.`);
  }
  return v;
}

function parseGlickoEntries(v: unknown, label: string): GlickoEntry[] {
  const arr = assertArray(v, label);
  return arr.map((item, i) => {
    if (!isObject(item)) {
      throw new ImportParseError(`"${label}[${i}]" precisa ser objeto.`);
    }
    return {
      id: assertString(item.id, `${label}[${i}].id`),
      r: assertNumber(item.r, `${label}[${i}].r`),
      rd: assertNumber(item.rd, `${label}[${i}].rd`),
      sigma: assertNumber(item.sigma, `${label}[${i}].sigma`),
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

  const notes =
    raw.notes === undefined ? [] : (assertArray(raw.notes, 'notes') as Note[]);
  const glicko =
    raw.glicko === undefined ? [] : parseGlickoEntries(raw.glicko, 'glicko');

  const tasks = assertArray(raw.tasks, 'tasks') as Task[];
  // Backward-compat: v1/v2 mantinham `completedTasks` separadas. Mescla
  // em `tasks` ajustando os campos: `archivedAt` → `completedAt`,
  // `archivedFromSectionName` → `completedFromSectionName`, e força
  // `checked=true`.
  if (raw.completedTasks !== undefined) {
    const completed = assertArray(raw.completedTasks, 'completedTasks');
    for (const item of completed) {
      if (!isObject(item)) continue;
      const t = item as Record<string, unknown>;
      const completedAt = t.completedAt ?? t.archivedAt ?? null;
      const completedFromSectionName =
        (t.completedFromSectionName as string | null | undefined) ??
        (t.archivedFromSectionName as string | null | undefined) ??
        null;
      const cleaned = { ...t };
      delete cleaned.archivedAt;
      delete cleaned.archivedFromSection;
      delete cleaned.archivedFromSectionName;
      tasks.push({
        ...(cleaned as unknown as Task),
        checked: true,
        completedAt: completedAt as Task['completedAt'],
        completedFromSectionName,
      });
    }
  }

  return {
    exportedAt: assertString(raw.exportedAt, 'exportedAt'),
    uid: assertString(raw.uid, 'uid'),
    version,
    sections: assertArray(raw.sections, 'sections') as Section[],
    tasks,
    projects: assertArray(raw.projects, 'projects') as Project[],
    notes,
    glicko,
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
