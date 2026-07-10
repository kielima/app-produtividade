import { describe, expect, it } from 'vitest';
import { buildRenamedFileName, normalizeNoteName, parseWikilinks } from './obsidianWikilink';

describe('parseWikilinks', () => {
  it('não encontra nada em texto sem wikilinks', () => {
    expect(parseWikilinks('texto qualquer')).toEqual([]);
  });

  it('encontra um único wikilink simples', () => {
    const text = 'veja [[Outra Nota]] para mais.';
    const links = parseWikilinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ raw: '[[Outra Nota]]', target: 'Outra Nota', alias: 'Outra Nota' });
    expect(text.slice(links[0].from, links[0].to)).toBe('[[Outra Nota]]');
  });

  it('encontra múltiplos wikilinks na mesma linha', () => {
    const text = '[[A]] e [[B]] e [[C]]';
    const links = parseWikilinks(text);
    expect(links.map((l) => l.target)).toEqual(['A', 'B', 'C']);
  });

  it('não cruza quebras de linha dentro de um mesmo colchete', () => {
    const text = '[[Nota\nQuebrada]] normal [[Ok]]';
    const links = parseWikilinks(text);
    expect(links.map((l) => l.raw)).toEqual(['[[Ok]]']);
  });

  it('separa alvo e apelido em [[Nota|Apelido]]', () => {
    const [link] = parseWikilinks('[[Projeto X|clique aqui]]');
    expect(link.target).toBe('Projeto X');
    expect(link.alias).toBe('clique aqui');
  });

  it('descarta a referência de cabeçalho em [[Nota#Título]] mas resolve a nota', () => {
    const [link] = parseWikilinks('[[Projeto X#Introdução]]');
    expect(link.target).toBe('Projeto X');
    expect(link.alias).toBe('Projeto X');
  });

  it('combina cabeçalho e apelido em [[Nota#Título|Apelido]]', () => {
    const [link] = parseWikilinks('[[Projeto X#Introdução|clique aqui]]');
    expect(link.target).toBe('Projeto X');
    expect(link.alias).toBe('clique aqui');
  });
});

describe('normalizeNoteName', () => {
  it('remove a extensão .md e normaliza caixa', () => {
    expect(normalizeNoteName('Minha Nota.MD')).toBe('minha nota');
  });

  it('não afeta nomes sem extensão', () => {
    expect(normalizeNoteName('Sem Extensão')).toBe('sem extensão');
  });
});

describe('buildRenamedFileName', () => {
  it('preserva a extensão .md', () => {
    expect(buildRenamedFileName('Nota Antiga.md', 'Nota Nova')).toBe('Nota Nova.md');
  });

  it('preserva outras extensões (imagem, pdf)', () => {
    expect(buildRenamedFileName('foto.jpg', 'foto-editada')).toBe('foto-editada.jpg');
    expect(buildRenamedFileName('Recibo.PDF', 'Recibo 2024')).toBe('Recibo 2024.PDF');
  });

  it('sem extensão (pasta): usa o nome novo como está', () => {
    expect(buildRenamedFileName('Projetos', 'Projetos Antigos')).toBe('Projetos Antigos');
  });

  it('nome com pontos no meio, sem extensão no final, não confunde', () => {
    expect(buildRenamedFileName('v1.2 rascunho', 'v1.3 rascunho')).toBe('v1.3 rascunho');
  });
});
