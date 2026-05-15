import { describe, expect, it } from 'vitest';
import { defaultFilename, summarize, type ExportPayload } from './exportData';

const SAMPLE: ExportPayload = {
  exportedAt: '2026-05-15T12:34:56.789Z',
  uid: 'user-123',
  version: 1,
  sections: [
    { id: 's1', name: 'A', moscow: 'must' },
    { id: 's2', name: 'B', moscow: '' },
  ],
  tasks: [
    {
      id: '1',
      taskId: 1,
      title: 'X [#0001]',
      note: '',
      checked: false,
      inProgress: false,
      moscow: '',
      modo: '',
      esforco: '',
      deadline: '',
      addedDate: '',
      dependsOn: [],
      subtasks: [],
      section: 's1',
    },
  ],
  completedTasks: [],
  projects: [],
  memory: {
    glossary: null,
    claude: null,
    projectsContext: [{ id: 'foo', content: '# foo' }],
    automations: [],
    context: [{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }],
  },
};

describe('defaultFilename', () => {
  it('uses exported date in YYYY-MM-DD', () => {
    expect(defaultFilename(SAMPLE)).toBe('app-produtividade-export-2026-05-15.json');
  });
});

describe('summarize', () => {
  it('returns counts for each collection', () => {
    expect(summarize(SAMPLE)).toEqual({
      sections: 2,
      tasks: 1,
      completedTasks: 0,
      projects: 0,
      memoryProjects: 1,
      memoryAutomations: 0,
      memoryContext: 2,
    });
  });
});

describe('payload shape', () => {
  it('is JSON-serializable without loss', () => {
    const json = JSON.stringify(SAMPLE);
    const parsed = JSON.parse(json) as ExportPayload;
    expect(parsed.uid).toBe('user-123');
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.memory.projectsContext[0]!.content).toBe('# foo');
  });
});
