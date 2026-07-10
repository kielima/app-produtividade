import { describe, expect, it } from 'vitest';
import { dedupeContentMatches } from './obsidianSearch';
import type { DriveNode } from './obsidianNode';

const node = (overrides: Partial<DriveNode>): DriveNode => ({
  id: 'x',
  name: 'x',
  mimeType: 'text/markdown',
  isFolder: false,
  ...overrides,
});

describe('dedupeContentMatches', () => {
  it('remove da lista de conteúdo os ids já presentes na lista de nome', () => {
    const byName = [node({ id: 'f1', name: 'Projeto X.md' })];
    const byContent = [
      node({ id: 'f1', name: 'Projeto X.md' }),
      node({ id: 'f2', name: 'Outra Nota.md' }),
    ];
    expect(dedupeContentMatches(byName, byContent)).toEqual([byContent[1]]);
  });

  it('mantém todos os itens de conteúdo quando não há sobreposição', () => {
    const byName = [node({ id: 'f1' })];
    const byContent = [node({ id: 'f2' }), node({ id: 'f3' })];
    expect(dedupeContentMatches(byName, byContent)).toEqual(byContent);
  });

  it('devolve vazio quando todos os itens de conteúdo já estão no de nome', () => {
    const byName = [node({ id: 'f1' }), node({ id: 'f2' })];
    const byContent = [node({ id: 'f1' }), node({ id: 'f2' })];
    expect(dedupeContentMatches(byName, byContent)).toEqual([]);
  });

  it('lida com listas vazias', () => {
    expect(dedupeContentMatches([], [])).toEqual([]);
    expect(dedupeContentMatches([node({ id: 'f1' })], [])).toEqual([]);
    expect(dedupeContentMatches([], [node({ id: 'f1' })])).toEqual([node({ id: 'f1' })]);
  });
});
