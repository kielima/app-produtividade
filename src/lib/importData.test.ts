import { describe, expect, it } from 'vitest';
import { ImportParseError, parseImportPayload } from './importData';
import type { ExportPayload } from './exportData';

const SAMPLE: ExportPayload = {
  exportedAt: '2026-05-15T12:34:56.789Z',
  uid: 'user-123',
  version: 2,
  sections: [{ id: 's1', name: 'A', moscow: 'must' }],
  tasks: [],
  completedTasks: [],
  projects: [],
  notes: [{ id: 'n1', title: 't', note: '', items: [], addedDate: '2026-05-15', tags: [], pinned: false }],
  glicko: [{ id: 'p1', r: 1500, rd: 350, sigma: 0.06 }],
  memory: {
    glossary: '# glossary',
    claude: null,
    projectsContext: [{ id: 'foo', content: '# foo' }],
    automations: [],
    context: [],
  },
};

describe('parseImportPayload', () => {
  it('roundtrips a valid export', () => {
    const parsed = parseImportPayload(JSON.stringify(SAMPLE));
    expect(parsed.uid).toBe('user-123');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]!.title).toBe('t');
    expect(parsed.glicko).toHaveLength(1);
    expect(parsed.glicko[0]).toEqual({ id: 'p1', r: 1500, rd: 350, sigma: 0.06 });
    expect(parsed.memory.projectsContext[0]!.content).toBe('# foo');
    expect(parsed.memory.glossary).toBe('# glossary');
    expect(parsed.memory.claude).toBeNull();
  });

  it('accepts v1 payloads without notes/glicko (backward compat)', () => {
    const v1 = {
      exportedAt: '2026-05-15T12:34:56.789Z',
      uid: 'user-123',
      version: 1,
      sections: [],
      tasks: [],
      completedTasks: [],
      projects: [],
      memory: {
        glossary: null,
        claude: null,
        projectsContext: [],
        automations: [],
        context: [],
      },
    };
    const parsed = parseImportPayload(JSON.stringify(v1));
    expect(parsed.notes).toEqual([]);
    expect(parsed.glicko).toEqual([]);
  });

  it('rejects malformed glicko entries', () => {
    const bad = { ...SAMPLE, glicko: [{ id: 'p1', r: 1500, rd: 350 }] };
    expect(() => parseImportPayload(JSON.stringify(bad))).toThrow(
      /glicko\[0\]\.sigma/,
    );
  });

  it('rejects non-JSON input', () => {
    expect(() => parseImportPayload('not json')).toThrow(ImportParseError);
    expect(() => parseImportPayload('not json')).toThrow(/JSON inválido/);
  });

  it('rejects non-object root', () => {
    expect(() => parseImportPayload('[]')).toThrow(/objeto na raiz/);
    expect(() => parseImportPayload('"foo"')).toThrow(/objeto na raiz/);
  });

  it('rejects missing required fields', () => {
    const incomplete = { ...SAMPLE, uid: undefined };
    expect(() => parseImportPayload(JSON.stringify(incomplete))).toThrow(
      /"uid"/,
    );
  });

  it('rejects future schema versions', () => {
    const fromFuture = { ...SAMPLE, version: 999 };
    expect(() => parseImportPayload(JSON.stringify(fromFuture))).toThrow(
      /mais nova/,
    );
  });

  it('rejects wrong type for version', () => {
    const bad = { ...SAMPLE, version: '1' };
    expect(() => parseImportPayload(JSON.stringify(bad))).toThrow(/"version"/);
  });

  it('rejects malformed memory subcollection items', () => {
    const bad = {
      ...SAMPLE,
      memory: { ...SAMPLE.memory, projectsContext: [{ id: 'x' }] },
    };
    expect(() => parseImportPayload(JSON.stringify(bad))).toThrow(
      /projectsContext\[0\]\.content/,
    );
  });

  it('rejects arrays in place of objects', () => {
    const bad = { ...SAMPLE, memory: [] };
    expect(() => parseImportPayload(JSON.stringify(bad))).toThrow(/"memory"/);
  });
});
