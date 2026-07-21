import { describe, expect, it } from 'vitest';
import { classifyByFileName } from './classifyByFilename';

describe('classifyByFileName', () => {
  it('reconhece "SOBRENOME, ANO.pdf"', () => {
    expect(classifyByFileName('SILVA, 2020.pdf')).toBe('article');
  });

  it('reconhece "SOBRENOME et al, ANO.pdf"', () => {
    expect(classifyByFileName('SILVA et al, 2020.pdf')).toBe('article');
  });

  it('reconhece "SOBRENOME; SOBRENOME2, ANO.pdf"', () => {
    expect(classifyByFileName('SILVA; SOUZA, 2020.pdf')).toBe('article');
  });

  it('reconhece com título depois do ano', () => {
    expect(classifyByFileName('SILVA, 2020 - Título do artigo.pdf')).toBe('article');
  });

  it('ignora nome de livro (título, sem padrão Autor-Ano)', () => {
    expect(classifyByFileName('Clean Code.pdf')).toBeNull();
  });

  it('ignora nome sem vírgula antes do ano', () => {
    expect(classifyByFileName('Relatório anual 2020.pdf')).toBeNull();
  });

  it('ignora ano fora da faixa plausível (19xx/20xx)', () => {
    expect(classifyByFileName('SILVA, 1820.pdf')).toBeNull();
  });

  it('não confunde um número de página/capítulo com o ano', () => {
    expect(classifyByFileName('Anexo 12, 3456.pdf')).toBeNull();
  });

  it('reconhece norma "NBR ....pdf"', () => {
    expect(classifyByFileName('NBR 5410.pdf')).toBe('Normas Técnicas');
  });

  it('reconhece norma "ISO ....pdf"', () => {
    expect(classifyByFileName('ISO 9001-2015.pdf')).toBe('Normas Técnicas');
  });

  it('reconhece norma mesmo com padrão de autor-ano (prioriza norma)', () => {
    expect(classifyByFileName('NBR 5410, 2004.pdf')).toBe('Normas Técnicas');
  });

  it('ignora prefixo NBR/ISO em minúsculas', () => {
    expect(classifyByFileName('nbr 5410.pdf')).toBeNull();
    expect(classifyByFileName('iso 9001.pdf')).toBeNull();
  });

  it('não confunde palavra que só começa com ISO com a norma', () => {
    expect(classifyByFileName('ISOLAMENTO térmico.pdf')).toBeNull();
  });
});
