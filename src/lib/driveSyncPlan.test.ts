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
});
