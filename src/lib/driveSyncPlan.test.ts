import { describe, expect, it } from 'vitest';
import type { ReadingItem } from '../types';
import { planDriveSyncItem } from './driveSyncPlan';

function item(overrides: Partial<ReadingItem> = {}): ReadingItem {
  return {
    id: 'f1',
    driveFileId: 'f1',
    format: 'pdf',
    title: 'Some title',
    authors: [],
    itemType: 'other',
    tags: [],
    addedDate: '2026-01-01',
    readingStatus: 'to-read',
    fileName: 'file.pdf',
    folderId: 'folder1',
    folderPath: 'Meu Drive / Artigos',
    ...overrides,
  };
}

describe('planDriveSyncItem', () => {
  it('cria um item novo quando não existe localmente', () => {
    const plan = planDriveSyncItem(undefined, {
      id: 'f1',
      name: 'paper.pdf',
      folderId: 'folder1',
      folderPath: 'Meu Drive / Artigos',
    });
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') throw new Error('expected create');
    expect(plan.item.id).toBe('f1');
    expect(plan.item.driveFileId).toBe('f1');
    expect(plan.item.fileName).toBe('paper.pdf');
    expect(plan.item.title).toBe('paper');
    expect(plan.item.folderId).toBe('folder1');
    expect(plan.item.folderPath).toBe('Meu Drive / Artigos');
    expect(plan.item.readingStatus).toBe('to-read');
  });

  it('não inclui folderId/folderPath no item novo quando o arquivo está na raiz', () => {
    const plan = planDriveSyncItem(undefined, { id: 'f1', name: 'paper.pdf' });
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') throw new Error('expected create');
    expect(plan.item.folderId).toBeUndefined();
    expect(plan.item.folderPath).toBeUndefined();
  });

  it('não muda nada quando o item existente já bate com o Drive', () => {
    const existing = item();
    const plan = planDriveSyncItem(existing, {
      id: 'f1',
      name: existing.fileName!,
      folderId: existing.folderId,
      folderPath: existing.folderPath,
    });
    expect(plan).toEqual({ kind: 'skip' });
  });

  it('gera um patch só com os campos que mudaram (renomeado no Drive)', () => {
    const existing = item();
    const plan = planDriveSyncItem(existing, {
      id: 'f1',
      name: 'novo-nome.pdf',
      folderId: existing.folderId,
      folderPath: existing.folderPath,
    });
    expect(plan).toEqual({ kind: 'update', patch: { fileName: 'novo-nome.pdf' } });
  });

  it('gera um patch quando o arquivo foi movido de pasta', () => {
    const existing = item();
    const plan = planDriveSyncItem(existing, {
      id: 'f1',
      name: existing.fileName!,
      folderId: 'folder2',
      folderPath: 'Meu Drive / Livros',
    });
    expect(plan).toEqual({
      kind: 'update',
      patch: { folderId: 'folder2', folderPath: 'Meu Drive / Livros' },
    });
  });

  it('nunca sobrescreve metadados editados pelo usuário (título, tags, etc.)', () => {
    const existing = item({ title: 'Título editado à mão', tags: ['importante'] });
    const plan = planDriveSyncItem(existing, {
      id: 'f1',
      name: 'novo-nome.pdf',
      folderId: existing.folderId,
      folderPath: existing.folderPath,
    });
    expect(plan).toEqual({ kind: 'update', patch: { fileName: 'novo-nome.pdf' } });
  });

  it('classifica como artigo pelo nome (estilo ABNT) ao criar um item novo', () => {
    const plan = planDriveSyncItem(undefined, { id: 'f1', name: 'SILVA, 2020.pdf' });
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') throw new Error('expected create');
    expect(plan.item.itemType).toBe('article');
    expect(plan.item.autoClassifiedAt).toEqual(expect.any(String));
  });

  it('cria um item EPUB pela extensão do nome quando não há mimeType', () => {
    const plan = planDriveSyncItem(undefined, { id: 'f2', name: 'book.epub' });
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') throw new Error('expected create');
    expect(plan.item.format).toBe('epub');
    expect(plan.item.title).toBe('book');
  });

  it('cria um item EPUB pelo mimeType do Drive', () => {
    const plan = planDriveSyncItem(undefined, {
      id: 'f2',
      name: 'book-sem-extensao',
      mimeType: 'application/epub+zip',
    });
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') throw new Error('expected create');
    expect(plan.item.format).toBe('epub');
  });

  it('classifica todo EPUB novo como livro, mesmo com nome em estilo ABNT de artigo', () => {
    const plan = planDriveSyncItem(undefined, { id: 'f2', name: 'SILVA, 2020.epub' });
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') throw new Error('expected create');
    expect(plan.item.itemType).toBe('book');
    expect(plan.item.autoClassifiedAt).toEqual(expect.any(String));
  });

  it('classifica como livro um EPUB antigo ainda sem tipo definido', () => {
    const existing = item({ format: 'epub', itemType: 'other', fileName: 'book.epub' });
    const plan = planDriveSyncItem(existing, {
      id: 'f1',
      name: 'book.epub',
      folderId: existing.folderId,
      folderPath: existing.folderPath,
    });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('expected update');
    expect(plan.patch.itemType).toBe('book');
    expect(plan.patch.autoClassifiedAt).toEqual(expect.any(String));
  });

  it('classifica pelo nome um item antigo ainda sem tipo definido', () => {
    const existing = item({ itemType: 'other', fileName: 'SILVA, 2020.pdf' });
    const plan = planDriveSyncItem(existing, {
      id: 'f1',
      name: 'SILVA, 2020.pdf',
      folderId: existing.folderId,
      folderPath: existing.folderPath,
    });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('expected update');
    expect(plan.patch.itemType).toBe('article');
    expect(plan.patch.autoClassifiedAt).toEqual(expect.any(String));
  });

  it('não reclassifica pelo nome um item que o usuário já classificou/a IA já tentou', () => {
    const existing = item({ itemType: 'book', fileName: 'SILVA, 2020.pdf' });
    const plan = planDriveSyncItem(existing, {
      id: 'f1',
      name: 'novo-nome, 2020.pdf',
      folderId: existing.folderId,
      folderPath: existing.folderPath,
    });
    expect(plan).toEqual({ kind: 'update', patch: { fileName: 'novo-nome, 2020.pdf' } });
  });
});
