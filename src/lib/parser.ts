import type {
  Esforco,
  Modo,
  MoSCoW,
  Project,
  ProjectPriority,
  ProjectStatus,
  Section,
  Task,
} from '../types';

export function taskSectionId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getDisplayTitle(title: string): string {
  const idx = title.indexOf('🔗');
  const base = idx === -1 ? title : title.slice(0, idx);
  return base
    .replace(/\s*\[#\d+\]/g, '')
    .replace(
      /\s*\[(Must|Should|Could|Won't|Wont|Manual|Colaborar|Delegar|Automatizar|Rápido|Rapido|Médio|Medio|Longo)\]/gi,
      '',
    )
    .replace(/\s*\[prazo:[^\]]+\]/gi, '')
    .replace(/\s*\(adicionado:\s*\d{4}-\d{2}-\d{2}\)/gi, '')
    .trim();
}

function normalizeMoscow(raw: string): MoSCoW {
  const v = raw.toLowerCase().replace("'", '');
  if (v === 'must' || v === 'should' || v === 'could' || v === 'wont') return v;
  return '';
}

function normalizeEsforco(raw: string): Esforco {
  const v = raw
    .toLowerCase()
    .replace('á', 'a')
    .replace('â', 'a')
    .replace('é', 'e')
    .replace('ê', 'e');
  if (v === 'rapido' || v === 'medio' || v === 'longo') return v;
  return '';
}

function normalizeModo(raw: string): Modo {
  const v = raw.toLowerCase();
  if (v === 'manual' || v === 'colaborar' || v === 'delegar' || v === 'automatizar') return v;
  return '';
}

export interface ParseTasksResult {
  sections: Section[];
  tasks: Record<string, Task[]>;
}

export function parseTaskMarkdown(content: string): ParseTasksResult {
  const resultSections: Section[] = [];
  const resultTasks: Record<string, Task[]> = {};
  let currentSectionId: string | null = null;
  let currentTask: Task | null = null;

  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const line of lines) {
    const headerMatch = line.match(/^## \*{0,2}(.+?)\*{0,2}$/);
    if (headerMatch) {
      if (currentTask && currentSectionId) {
        resultTasks[currentSectionId]!.push(currentTask);
        currentTask = null;
      }

      const sectionName = headerMatch[1]!.trim();
      currentSectionId = taskSectionId(sectionName);

      if (!resultTasks[currentSectionId]) {
        const secMoscowMatch = sectionName.match(/\[(Must|Should|Could|Won'?t)\]/i);
        const secMoscow: MoSCoW = secMoscowMatch ? normalizeMoscow(secMoscowMatch[1]!) : '';
        resultSections.push({ id: currentSectionId, name: sectionName, moscow: secMoscow });
        resultTasks[currentSectionId] = [];
      }
      continue;
    }

    const taskLineMatch = currentSectionId && line.match(/^- \[[ xX/\-]\]/);
    if (taskLineMatch) {
      if (currentTask) {
        resultTasks[currentSectionId!]!.push(currentTask);
      }
      const checked = /\[[xX]\]/.test(line);
      const inProgress = /\[[\-/]\]/.test(line);
      const text = line.replace(/^- \[[ xX/\-]\]\s*/, '');

      let title = text;
      let note = '';
      const boldMatch = text.match(/^\*\*(.+?)\*\*(.*)$/);
      if (boldMatch) {
        title = boldMatch[1]!;
        note = boldMatch[2]!.replace(/^\s*-\s*/, '').trim();
      }

      const moscowMatch = title.match(/\[(Must|Should|Could|Won'?t)\]/i);
      const moscow: MoSCoW = moscowMatch ? normalizeMoscow(moscowMatch[1]!) : '';

      const modoMatch = title.match(/\[(Delegar|Colaborar|Automatizar|Manual)\]/i);
      const modo: Modo = modoMatch ? normalizeModo(modoMatch[1]!) : '';

      const esforcoMatch = title.match(/\[(R[áa]pido|M[ée]dio|Longo)\]/i);
      const esforco: Esforco = esforcoMatch ? normalizeEsforco(esforcoMatch[1]!) : '';

      const prazoMatch = title.match(/\[prazo:\s*(\d{4}-\d{2}-\d{2})\]/i);
      const deadline = prazoMatch ? prazoMatch[1]! : '';

      const addedMatch = title.match(/\(adicionado:\s*(\d{4}-\d{2}-\d{2})\)/i);
      const addedDate = addedMatch ? addedMatch[1]! : '';

      const taskIdMatch = title.match(/\[#(\d+)\]/);
      const taskId = taskIdMatch ? parseInt(taskIdMatch[1]!, 10) : null;

      const dependsOn: string[] = [];
      const depIdx = title.indexOf('🔗');
      if (depIdx !== -1) {
        title
          .slice(depIdx)
          .split('🔗')
          .slice(1)
          .forEach((part) => {
            let dep = part.replace(/^\s*depende:\s*/i, '').trim();
            dep = dep.split(/[\[\n]/)[0]!.trim();
            if (dep) dependsOn.push(dep);
          });
      }

      currentTask = {
        id: taskId !== null ? String(taskId) : `tmp-${Math.random().toString(36).slice(2)}`,
        taskId,
        title,
        note,
        checked,
        inProgress,
        moscow,
        modo,
        esforco,
        deadline,
        addedDate,
        dependsOn,
        subtasks: [],
        section: currentSectionId!,
      };
      continue;
    }

    if (currentTask && /^\s+- \[[ xX]\]/.test(line)) {
      const subChecked = /\[[xX]\]/.test(line);
      const text = line.replace(/^\s+- \[[ xX]\]\s*/, '');
      currentTask.subtasks.push({ text, checked: subChecked });
    }
  }

  if (currentTask && currentSectionId) {
    resultTasks[currentSectionId]!.push(currentTask);
  }

  return { sections: resultSections, tasks: resultTasks };
}

/**
 * Atribui sequencial `[#NNN]` a tarefas sem ID e injeta `(adicionado: hoje)`.
 * Mutates input. Devolve referência ao mesmo objeto. Equivalente aos passos
 * 1, 2 e 4 do `assignAndMigrateIds()` do dashboard. Migração de deps legados
 * (passo 3) acontece via score.ts/buildDependencyMap em tempo de leitura.
 */
export function assignTaskIds(
  result: ParseTasksResult,
  today: string = new Date().toISOString().slice(0, 10),
): ParseTasksResult {
  let maxId = 0;
  for (const sec of result.sections) {
    for (const t of result.tasks[sec.id] ?? []) {
      if (t.taskId != null && t.taskId > maxId) maxId = t.taskId;
    }
  }

  let nextId = maxId + 1;
  for (const sec of result.sections) {
    for (const t of result.tasks[sec.id] ?? []) {
      if (t.taskId == null) {
        t.taskId = nextId++;
        const idTag = `[#${String(t.taskId).padStart(4, '0')}]`;
        const dIdx = t.title.indexOf('🔗');
        t.title =
          dIdx !== -1
            ? t.title.slice(0, dIdx).trimEnd() + ' ' + idTag + ' ' + t.title.slice(dIdx)
            : t.title.trimEnd() + ' ' + idTag;
        t.id = String(t.taskId);
      }

      if (!/\(adicionado:\s*\d{4}-\d{2}-\d{2}\)/i.test(t.title)) {
        const dIdx = t.title.indexOf('🔗');
        t.title =
          dIdx !== -1
            ? t.title.slice(0, dIdx).trimEnd() +
              ` (adicionado: ${today}) ` +
              t.title.slice(dIdx)
            : t.title.trimEnd() + ` (adicionado: ${today})`;
        t.addedDate = today;
      }
    }
  }

  return result;
}

/**
 * Parser de Meus_Projetos.md.
 *
 * Formato esperado (baseado no plano §3.2 e DASHBOARD_CONTEXTO):
 *
 *   ## Nome do Projeto [Em andamento] [P1]
 *   Área: Pessoal & Saúde / Estética & Corpo
 *   🎯 Objetivo: ...
 *   📌 Status atual: ...
 *   ➡️ Próximos passos: ...
 *   📅 Prazo: 2026-12-01
 *   ⏱️ Duração estimada: 3 meses
 *   🔗 Depende de: outro-projeto
 *   📝 Notas:
 *   ...texto livre...
 *
 * Linhas não reconhecidas dentro de uma seção vão pra `notes`.
 * Ajustar quando rodar a migração real e confirmar o formato exato.
 */
export function parseProjectMarkdown(content: string): Project[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const projects: Project[] = [];
  let current: Project | null = null;
  let notesBuffer: string[] = [];

  const flush = () => {
    if (!current) return;
    if (notesBuffer.length > 0) {
      current.notes = (current.notes ? current.notes + '\n' : '') + notesBuffer.join('\n').trim();
    }
    projects.push(current);
    current = null;
    notesBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const header = line.match(/^##\s+\*{0,2}(.+?)\*{0,2}$/);
    if (header) {
      flush();
      let name = header[1]!.trim();
      const statusMatch = name.match(/\[(A iniciar|Em andamento|Pausado|Conclu[íi]do|Cancelado)\]/i);
      const priorityMatch = name.match(/\[(P[123])\]/i);
      const status: ProjectStatus = statusMatch
        ? (statusMatch[1]!
            .replace('Concluido', 'Concluído') as ProjectStatus)
        : '';
      const priority: ProjectPriority = priorityMatch
        ? (priorityMatch[1]!.toUpperCase() as ProjectPriority)
        : '';
      name = name
        .replace(/\[(A iniciar|Em andamento|Pausado|Conclu[íi]do|Cancelado)\]/i, '')
        .replace(/\[(P[123])\]/i, '')
        .trim();

      current = {
        id: taskSectionId(name),
        name,
        area: '',
        status,
        priority,
        objective: '',
        currentStatus: '',
        nextSteps: '',
        deadline: '',
        estimatedDuration: '',
        dependsOn: '',
        notes: '',
      };
      continue;
    }

    if (!current) continue;

    const areaM = line.match(/^[\s>]*[ÁA]rea:\s*(.+)$/i);
    if (areaM) {
      current.area = areaM[1]!.trim();
      continue;
    }
    const objM = line.match(/^[\s>]*🎯\s*(?:Objetivo:?)?\s*(.+)$/i);
    if (objM) {
      current.objective = objM[1]!.trim();
      continue;
    }
    const statM = line.match(/^[\s>]*📌\s*(?:Status(?:\s+atual)?:?)?\s*(.+)$/i);
    if (statM) {
      current.currentStatus = statM[1]!.trim();
      continue;
    }
    const nextM = line.match(/^[\s>]*➡️\s*(?:Pr[óo]ximos?\s+passos?:?)?\s*(.+)$/i);
    if (nextM) {
      current.nextSteps = nextM[1]!.trim();
      continue;
    }
    const dateM = line.match(/^[\s>]*📅\s*(?:Prazo:?)?\s*(\d{4}-\d{2}-\d{2})/i);
    if (dateM) {
      current.deadline = dateM[1]!;
      continue;
    }
    const durM = line.match(/^[\s>]*⏱️?\s*(?:Dura[çc][ãa]o(?:\s+estimada)?:?)?\s*(.+)$/i);
    if (durM) {
      current.estimatedDuration = durM[1]!.trim();
      continue;
    }
    const depM = line.match(/^[\s>]*🔗\s*(?:Depende(?:\s+de)?:?)?\s*(.+)$/i);
    if (depM) {
      current.dependsOn = depM[1]!.trim();
      continue;
    }

    if (line.trim()) notesBuffer.push(line);
  }

  flush();
  return projects;
}
