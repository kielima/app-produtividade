import {
  EXPORT_VERSION,
  type ExportPayload,
  type GlickoEntry,
  type MemoryDoc,
} from './exportData';
import { serializeTitle } from './parser';
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
 * Backward-compat: até a v3 cada tarefa carregava uma lista embutida
 * `subtasks` ([{ text, checked, blockedByPrev }]). Hoje subtarefa é uma
 * tarefa-filha de verdade (`parentId`), então converte-se cada item numa
 * tarefa nova — ids sequenciais a partir do maior `taskId` do payload,
 * `order` preservando a ordem da lista e `blockedByPrev` virando dependência
 * `#<taskId>` da irmã anterior (itens sem texto são descartados, então a
 * "anterior" é sempre uma irmã que existe de fato). Sem isso, importar um
 * backup antigo perderia silenciosamente os itens, já que o campo legado não
 * é mais gravado.
 *
 * `completedAt` fica null nas filhas já concluídas: o formato antigo não
 * guardava a data de conclusão do item, e inventar "agora" criaria um pico
 * falso nas estatísticas.
 */
export function migrateLegacySubtasks(tasks: Task[]): Task[] {
  let nextTaskId = tasks.reduce((max, t) => Math.max(max, t.taskId ?? 0), 0);
  const out: Task[] = [];

  for (const task of tasks) {
    const legacy = (task as Task & { subtasks?: unknown }).subtasks;
    const cleaned = { ...task };
    delete (cleaned as Task & { subtasks?: unknown }).subtasks;
    out.push(cleaned);
    if (!Array.isArray(legacy) || legacy.length === 0) continue;

    let prevTaskId: number | null = null;
    let order = 0;
    for (const raw of legacy) {
      if (!isObject(raw)) continue;
      const text = typeof raw.text === 'string' ? raw.text : '';
      if (!text.trim()) continue;
      const checked = raw.checked === true;
      const dependsOn =
        raw.blockedByPrev === true && prevTaskId != null ? [`#${prevTaskId}`] : [];
      const taskId = ++nextTaskId;
      const addedDate = cleaned.addedDate ?? '';
      out.push({
        id: String(taskId),
        taskId,
        title: serializeTitle(text, {
          taskId,
          modo: 'manual',
          moscow: '',
          esforco: '',
          deadline: '',
          addedDate,
          dependsOn,
        }),
        note: '',
        checked,
        inProgress: false,
        moscow: '',
        modo: 'manual',
        esforco: '',
        deadline: '',
        addedDate,
        dependsOn,
        parentId: cleaned.id,
        order: order++,
        section: cleaned.section ?? '',
        completedAt: null,
      });
      prevTaskId = taskId;
    }
  }

  return out;
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
    tasks: migrateLegacySubtasks(tasks),
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
