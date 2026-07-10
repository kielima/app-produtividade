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
});
