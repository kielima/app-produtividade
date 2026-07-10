import { describe, expect, it } from 'vitest';
import { extractWikilinkRanges } from './obsidianWikilinkHighlight';

describe('extractWikilinkRanges', () => {
  it('não encontra nada em texto sem wikilinks', () => {
    expect(extractWikilinkRanges('texto qualquer')).toEqual([]);
  });

  it('encontra um único wikilink', () => {
    const text = 'veja [[Outra Nota]] para mais.';
    const ranges = extractWikilinkRanges(text);
    expect(ranges).toHaveLength(1);
    const { from, to } = ranges[0];
    expect(text.slice(from, to)).toBe('[[Outra Nota]]');
  });

  it('encontra múltiplos wikilinks na mesma linha', () => {
    const text = '[[A]] e [[B]] e [[C]]';
    const ranges = extractWikilinkRanges(text);
    expect(ranges.map(({ from, to }) => text.slice(from, to))).toEqual(['[[A]]', '[[B]]', '[[C]]']);
  });

  it('não cruza quebras de linha dentro de um mesmo colchete', () => {
    const text = '[[Nota\nQuebrada]] normal [[Ok]]';
    const ranges = extractWikilinkRanges(text);
    expect(ranges.map(({ from, to }) => text.slice(from, to))).toEqual(['[[Ok]]']);
  });
});
