import { describe, expect, it } from 'vitest';
import { buildNameIndex, computeBacklinks, resolveWikilinkTarget } from './obsidianBacklinks';

describe('buildNameIndex / resolveWikilinkTarget', () => {
  it('resolve pelo nome sem extensão e sem diferenciar caixa', () => {
    const index = buildNameIndex([
      { id: 'f1', name: 'Projeto X.md' },
      { id: 'f2', name: 'Outra Nota.md' },
    ]);
    expect(resolveWikilinkTarget(index, 'projeto x')).toBe('f1');
    expect(resolveWikilinkTarget(index, 'Projeto X')).toBe('f1');
  });

  it('devolve undefined quando o alvo não está no índice', () => {
    const index = buildNameIndex([{ id: 'f1', name: 'Projeto X.md' }]);
    expect(resolveWikilinkTarget(index, 'Inexistente')).toBeUndefined();
  });
});

describe('computeBacklinks', () => {
  it('encontra notas que citam o alvo via wikilink', () => {
    const notes = [
      { id: 'f1', name: 'A.md', content: 'veja [[B]] e [[C|apelido]]' },
      { id: 'f2', name: 'B.md', content: 'nada aqui' },
      { id: 'f3', name: 'C.md', content: 'referencia [[A]]' },
    ];
    expect(computeBacklinks(notes, 'B')).toEqual([{ id: 'f1', name: 'A.md' }]);
    expect(computeBacklinks(notes, 'C')).toEqual([{ id: 'f1', name: 'A.md' }]);
    expect(computeBacklinks(notes, 'A')).toEqual([{ id: 'f3', name: 'C.md' }]);
  });

  it('não inclui a própria nota nem notas sem citação', () => {
    const notes = [{ id: 'f1', name: 'A.md', content: 'sem links aqui' }];
    expect(computeBacklinks(notes, 'A')).toEqual([]);
  });

  it('ignora diferenças de caixa e de extensão .md no alvo', () => {
    const notes = [{ id: 'f1', name: 'A.md', content: 'veja [[projeto x]]' }];
    expect(computeBacklinks(notes, 'Projeto X.md')).toEqual([{ id: 'f1', name: 'A.md' }]);
  });
});
