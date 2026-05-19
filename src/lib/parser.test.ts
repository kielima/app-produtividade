import { describe, expect, it } from 'vitest';
import {
  assignTaskIds,
  getDisplayTitle,
  parseProjectMarkdown,
  parseTaskMarkdown,
  serializeTitle,
  taskSectionId,
} from './parser';

describe('taskSectionId', () => {
  it('slugifies section names', () => {
    expect(taskSectionId('Carreira [Must]')).toBe('carreira-must');
    expect(taskSectionId('Corrigir pptx D')).toBe('corrigir-pptx-d');
    expect(taskSectionId('Pessoal & Saúde')).toBe('pessoal-sa-de');
  });
});

describe('getDisplayTitle', () => {
  it('strips all tags from a title', () => {
    const raw =
      'Mudar nome no Itaú [#0055] [Manual] [Should] [Rápido] [prazo: 2026-05-15] (adicionado: 2026-04-10) 🔗 #0042';
    expect(getDisplayTitle(raw)).toBe('Mudar nome no Itaú');
  });

  it('keeps title intact if no tags', () => {
    expect(getDisplayTitle('Comprar pão')).toBe('Comprar pão');
  });
});

describe('parseTaskMarkdown', () => {
  it('parses sections and tasks with full metadata', () => {
    const md = `## Carreira [Must]

- [ ] **Atualizar CV [#0042] [Manual] [Should] [Rápido] [prazo: 2026-05-20] (adicionado: 2026-04-01) 🔗 #0017** - revisar inglês
  - [ ] sub A
  - [x] sub B
- [x] **Tarefa concluída [#0043] [Delegar] [Could]**
`;

    const { sections, tasks } = parseTaskMarkdown(md);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: 'carreira-must',
      name: 'Carreira [Must]',
      moscow: 'must',
    });

    const section = sections[0]!;
    const list = tasks[section.id]!;
    expect(list).toHaveLength(2);

    const t0 = list[0]!;
    expect(t0.taskId).toBe(42);
    expect(t0.id).toBe('42');
    expect(t0.checked).toBe(false);
    expect(t0.inProgress).toBe(false);
    expect(t0.moscow).toBe('should');
    expect(t0.modo).toBe('manual');
    expect(t0.esforco).toBe('rapido');
    expect(t0.deadline).toBe('2026-05-20');
    expect(t0.addedDate).toBe('2026-04-01');
    expect(t0.dependsOn).toEqual(['#0017']);
    expect(t0.note).toBe('revisar inglês');
    expect(t0.subtasks).toEqual([
      { text: 'sub A', checked: false },
      { text: 'sub B', checked: true },
    ]);

    const t1 = list[1]!;
    expect(t1.checked).toBe(true);
    expect(t1.modo).toBe('delegar');
    expect(t1.moscow).toBe('could');
  });

  it('parses in-progress status [/] and [-]', () => {
    const md = `## Sec
- [/] **A**
- [-] **B**
- [ ] **C**
`;
    const { tasks } = parseTaskMarkdown(md);
    const list = tasks['sec']!;
    expect(list[0]!.inProgress).toBe(true);
    expect(list[1]!.inProgress).toBe(true);
    expect(list[2]!.inProgress).toBe(false);
  });

  it('parses legacy dependencies (palavras) alongside new (#NNN)', () => {
    const md = `## Sec
- [ ] **Tarefa A [#0001]**
- [ ] **Tarefa B [#0002] 🔗 #0001 🔗 algumas palavras legado**
`;
    const { tasks } = parseTaskMarkdown(md);
    const t = tasks['sec']![1]!;
    expect(t.dependsOn).toEqual(['#0001', 'algumas palavras legado']);
  });

  it('handles CRLF line endings', () => {
    const md = '## Sec\r\n- [ ] **A [#0001]**\r\n';
    const { sections, tasks } = parseTaskMarkdown(md);
    expect(sections).toHaveLength(1);
    expect(tasks['sec']).toHaveLength(1);
  });
});

describe('assignTaskIds', () => {
  it('assigns sequential IDs to tasks missing one and stamps addedDate', () => {
    const md = `## Sec
- [ ] **Já tem ID [#0010]**
- [ ] **Sem ID**
- [ ] **Outra sem ID**
`;
    const parsed = parseTaskMarkdown(md);
    assignTaskIds(parsed, '2026-05-15');

    const list = parsed.tasks['sec']!;
    expect(list[0]!.taskId).toBe(10);
    expect(list[1]!.taskId).toBe(11);
    expect(list[2]!.taskId).toBe(12);
    expect(list[1]!.title).toContain('[#0011]');
    expect(list[1]!.title).toContain('(adicionado: 2026-05-15)');
    expect(list[1]!.addedDate).toBe('2026-05-15');
    expect(list[1]!.id).toBe('11');
  });

  it('does not stamp addedDate when already present', () => {
    const md = `## Sec
- [ ] **A [#0001] (adicionado: 2025-01-01)**
`;
    const parsed = parseTaskMarkdown(md);
    assignTaskIds(parsed, '2026-05-15');
    const t = parsed.tasks['sec']![0]!;
    expect(t.addedDate).toBe('2025-01-01');
    expect(t.title.match(/\(adicionado:/g)).toHaveLength(1);
  });
});

describe('serializeTitle', () => {
  it('reconstructs raw title with all tags in canonical order', () => {
    const out = serializeTitle('Atualizar CV', {
      taskId: 42,
      modo: 'manual',
      moscow: 'should',
      esforco: 'rapido',
      deadline: '2026-05-20',
      addedDate: '2026-04-01',
      dependsOn: ['#0017'],
    });
    expect(out).toBe(
      'Atualizar CV [#0042] [Manual] [Should] [Rápido] [prazo: 2026-05-20] (adicionado: 2026-04-01) 🔗 #0017',
    );
  });

  it('omits absent fields cleanly', () => {
    expect(
      serializeTitle('Sem nada', {
        taskId: null,
        modo: 'manual',
        moscow: '',
        esforco: '',
        deadline: '',
        addedDate: '',
        dependsOn: [],
      }),
    ).toBe('Sem nada [Manual]');
  });

  it('roundtrips: getDisplayTitle(serializeTitle(d, t)) === d', () => {
    const display = 'Mudar nome no Itaú';
    const meta = {
      taskId: 55,
      modo: 'manual' as const,
      moscow: 'must' as const,
      esforco: 'longo' as const,
      deadline: '2026-08-10',
      addedDate: '2026-05-01',
      dependsOn: ['#0042', '#0017'],
    };
    const raw = serializeTitle(display, meta);
    expect(getDisplayTitle(raw)).toBe(display);
  });

  it("uses Won't with apostrophe for wont MoSCoW", () => {
    const out = serializeTitle('X', {
      taskId: null,
      modo: 'manual',
      moscow: 'wont',
      esforco: '',
      deadline: '',
      addedDate: '',
      dependsOn: [],
    });
    expect(out).toBe("X [Manual] [Won't]");
  });
});

describe('parseProjectMarkdown', () => {
  it('parses a project with all fields', () => {
    const md = `## Depilação a Laser [Em andamento] [P1]
Área: Pessoal & Saúde / Estética & Corpo
🎯 Eliminar pelos definitivamente
📌 Pacotes contratados, aguardando agenda
➡️ Agendar as próximas datas
📅 Prazo: 2026-12-01
⏱️ 3 meses
🔗 outro-projeto
Notas livres aqui
linha 2 de notas
`;
    const projects = parseProjectMarkdown(md);
    expect(projects).toHaveLength(1);
    const p = projects[0]!;
    expect(p.name).toBe('Depilação a Laser');
    expect(p.status).toBe('Em andamento');
    expect(p.priority).toBe('P1');
    expect(p.area).toBe('Pessoal & Saúde / Estética & Corpo');
    expect(p.objective).toBe('Eliminar pelos definitivamente');
    expect(p.currentStatus).toBe('Pacotes contratados, aguardando agenda');
    expect(p.nextSteps).toBe('Agendar as próximas datas');
    expect(p.deadline).toBe('2026-12-01');
    expect(p.estimatedDuration).toBe('3 meses');
    expect(p.dependsOn).toBe('outro-projeto');
    expect(p.notes).toContain('Notas livres aqui');
  });

  it('parses multiple projects', () => {
    const md = `## P1 [A iniciar] [P2]
🎯 obj 1
## P2 [Pausado] [P3]
🎯 obj 2
`;
    const projects = parseProjectMarkdown(md);
    expect(projects).toHaveLength(2);
    expect(projects[0]!.name).toBe('P1');
    expect(projects[1]!.name).toBe('P2');
  });
});
