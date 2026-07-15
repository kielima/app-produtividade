import { describe, expect, it } from 'vitest';
import { replaceWikilinkTarget } from './grafosWikilinkReplace';

describe('replaceWikilinkTarget', () => {
  it('substitui um wikilink simples', () => {
    expect(replaceWikilinkTarget('veja [[Projeto X]] aqui', 'Projeto X', 'Projeto Y')).toBe(
      'veja [[Projeto Y]] aqui',
    );
  });

  it('preserva o apelido original', () => {
    expect(
      replaceWikilinkTarget('[[Projeto X|clique aqui]]', 'Projeto X', 'Projeto Y'),
    ).toBe('[[Projeto Y|clique aqui]]');
  });

  it('preserva a referência de cabeçalho original', () => {
    expect(
      replaceWikilinkTarget('[[Projeto X#Introdução]]', 'Projeto X', 'Projeto Y'),
    ).toBe('[[Projeto Y#Introdução]]');
  });

  it('preserva cabeçalho e apelido juntos', () => {
    expect(
      replaceWikilinkTarget('[[Projeto X#Introdução|clique aqui]]', 'Projeto X', 'Projeto Y'),
    ).toBe('[[Projeto Y#Introdução|clique aqui]]');
  });

  it('não afeta wikilinks de outras notas', () => {
    expect(replaceWikilinkTarget('[[Outra Nota]] e [[Projeto X]]', 'Projeto X', 'Projeto Y')).toBe(
      '[[Outra Nota]] e [[Projeto Y]]',
    );
  });

  it('ignora diferença de caixa e extensão .md ao comparar o alvo', () => {
    expect(replaceWikilinkTarget('[[projeto x.md]]', 'Projeto X', 'Projeto Y')).toBe(
      '[[Projeto Y]]',
    );
  });

  it('substitui múltiplas ocorrências', () => {
    expect(replaceWikilinkTarget('[[Projeto X]] ... [[Projeto X]]', 'Projeto X', 'Projeto Y')).toBe(
      '[[Projeto Y]] ... [[Projeto Y]]',
    );
  });

  it('não altera o conteúdo quando não há citação ao alvo', () => {
    const content = '[[Outra Nota]] sem relação';
    expect(replaceWikilinkTarget(content, 'Projeto X', 'Projeto Y')).toBe(content);
  });
});
