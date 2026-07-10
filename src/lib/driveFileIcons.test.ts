import { describe, expect, it } from 'vitest';
import { driveIconKind } from './driveFileIcons';
import { isMarkdownFile } from './obsidianNode';

describe('driveIconKind', () => {
  it('reconhece pastas', () => {
    expect(driveIconKind({ name: 'Projetos', mimeType: 'application/vnd.google-apps.folder' })).toBe(
      'folder',
    );
  });

  it('reconhece notas markdown pelo sufixo do nome mesmo com mimeType genérico', () => {
    expect(driveIconKind({ name: 'ideias.md', mimeType: 'text/plain' })).toBe('markdown');
  });

  it('reconhece Google Docs, Sheets e Slides nativos', () => {
    expect(
      driveIconKind({ name: 'Relatório', mimeType: 'application/vnd.google-apps.document' }),
    ).toBe('doc');
    expect(
      driveIconKind({ name: 'Planilha', mimeType: 'application/vnd.google-apps.spreadsheet' }),
    ).toBe('sheet');
    expect(
      driveIconKind({ name: 'Slides', mimeType: 'application/vnd.google-apps.presentation' }),
    ).toBe('slide');
  });

  it('reconhece PDFs e imagens', () => {
    expect(driveIconKind({ name: 'artigo.pdf', mimeType: 'application/pdf' })).toBe('pdf');
    expect(driveIconKind({ name: 'foto.jpg', mimeType: 'image/jpeg' })).toBe('image');
  });

  it('cai no fallback genérico para tipos desconhecidos', () => {
    expect(driveIconKind({ name: 'dados.bin', mimeType: 'application/octet-stream' })).toBe('file');
  });
});

describe('isMarkdownFile', () => {
  it('reconhece .md em maiúsculas', () => {
    expect(isMarkdownFile({ name: 'Nota.MD', mimeType: '' })).toBe(true);
  });

  it('reconhece mimeType text/markdown mesmo sem extensão .md', () => {
    expect(isMarkdownFile({ name: 'nota-sem-extensao', mimeType: 'text/markdown' })).toBe(true);
  });

  it('não confunde um Google Doc nativo cujo nome termine em .md', () => {
    // Google Docs/Sheets/Slides nativos não têm conteúdo binário próprio —
    // alt=media rejeita esses ids, então nunca contam como markdown mesmo
    // que o usuário nomeie o arquivo terminando em ".md".
    expect(
      isMarkdownFile({ name: 'doc.md', mimeType: 'application/vnd.google-apps.document' }),
    ).toBe(false);
  });

  it('não reconhece outros tipos comuns', () => {
    expect(isMarkdownFile({ name: 'foto.png', mimeType: 'image/png' })).toBe(false);
  });
});
