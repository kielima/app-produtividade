import { describe, expect, it } from 'vitest';
import { initialVaultState, obsidianTreeReducer } from './obsidianTreeState';
import type { DriveNode } from './obsidianNode';

const noteFile: DriveNode = { id: 'f1', name: 'Nota.md', mimeType: 'text/markdown', isFolder: false };
const folderFile: DriveNode = {
  id: 'p1',
  name: 'Projetos',
  mimeType: 'application/vnd.google-apps.folder',
  isFolder: true,
};

describe('obsidianTreeReducer', () => {
  it('transições de carregamento de pasta: idle -> loading -> loaded', () => {
    let state = initialVaultState();
    state = obsidianTreeReducer(state, { type: 'FOLDER_LOAD_START', folderId: 'root' });
    expect(state.folders.get('root')?.status).toBe('loading');

    state = obsidianTreeReducer(state, {
      type: 'FOLDER_LOADED',
      folderId: 'root',
      children: [noteFile, folderFile],
    });
    expect(state.folders.get('root')?.status).toBe('loaded');
    expect(state.folders.get('root')?.children).toHaveLength(2);
  });

  it('registra erro de carregamento de pasta sem afetar outras pastas', () => {
    let state = initialVaultState();
    state = obsidianTreeReducer(state, {
      type: 'FOLDER_LOADED',
      folderId: 'root',
      children: [folderFile],
    });
    state = obsidianTreeReducer(state, {
      type: 'FOLDER_ERROR',
      folderId: 'p1',
      error: 'falhou',
    });
    expect(state.folders.get('p1')?.status).toBe('error');
    expect(state.folders.get('p1')?.error).toBe('falhou');
    expect(state.folders.get('root')?.status).toBe('loaded');
  });

  it('expandedIds adiciona e remove pelo EXPANDED_SET', () => {
    let state = initialVaultState();
    state = obsidianTreeReducer(state, { type: 'EXPANDED_SET', folderId: 'p1', expanded: true });
    expect(state.expandedIds.has('p1')).toBe(true);
    state = obsidianTreeReducer(state, { type: 'EXPANDED_SET', folderId: 'p1', expanded: false });
    expect(state.expandedIds.has('p1')).toBe(false);
  });

  it('transições de nota: loaded marca dirty=false, edit marca dirty=true', () => {
    let state = initialVaultState();
    state = obsidianTreeReducer(state, {
      type: 'NOTE_LOADED',
      fileId: 'f1',
      content: '# Título',
      modifiedTime: 't1',
    });
    expect(state.notes.get('f1')).toMatchObject({
      status: 'loaded',
      content: '# Título',
      loadedModifiedTime: 't1',
      dirty: false,
    });

    state = obsidianTreeReducer(state, { type: 'NOTE_EDIT', fileId: 'f1', content: '# Editado' });
    expect(state.notes.get('f1')).toMatchObject({ content: '# Editado', dirty: true });
  });

  it('NOTE_SAVED limpa dirty e atualiza a baseline de conflito', () => {
    let state = initialVaultState();
    state = obsidianTreeReducer(state, {
      type: 'NOTE_LOADED',
      fileId: 'f1',
      content: 'a',
      modifiedTime: 't1',
    });
    state = obsidianTreeReducer(state, { type: 'NOTE_EDIT', fileId: 'f1', content: 'b' });
    state = obsidianTreeReducer(state, { type: 'NOTE_SAVED', fileId: 'f1', modifiedTime: 't2' });
    expect(state.notes.get('f1')).toMatchObject({
      status: 'loaded',
      dirty: false,
      loadedModifiedTime: 't2',
    });
  });

  it('CONFLICT_DETECTED abre o estado de comparação e CONFLICT_DISMISSED fecha', () => {
    let state = initialVaultState();
    state = obsidianTreeReducer(state, {
      type: 'CONFLICT_DETECTED',
      fileId: 'f1',
      fileName: 'Nota.md',
      parentFolderId: 'root',
      localContent: 'local',
      remoteContent: 'remoto',
      remoteModifiedTime: 't2',
    });
    expect(state.conflict).toMatchObject({ status: 'comparing', fileId: 'f1' });

    state = obsidianTreeReducer(state, { type: 'CONFLICT_DISMISSED' });
    expect(state.conflict).toEqual({ status: 'none' });
  });

  it('NOTE_REPLACE_CONTENT substitui o conteúdo local e fecha o conflito', () => {
    let state = initialVaultState();
    state = obsidianTreeReducer(state, {
      type: 'NOTE_LOADED',
      fileId: 'f1',
      content: 'local',
      modifiedTime: 't1',
    });
    state = obsidianTreeReducer(state, {
      type: 'CONFLICT_DETECTED',
      fileId: 'f1',
      fileName: 'Nota.md',
      parentFolderId: 'root',
      localContent: 'local',
      remoteContent: 'remoto',
      remoteModifiedTime: 't2',
    });
    state = obsidianTreeReducer(state, {
      type: 'NOTE_REPLACE_CONTENT',
      fileId: 'f1',
      content: 'remoto',
      modifiedTime: 't2',
    });
    expect(state.notes.get('f1')).toMatchObject({
      content: 'remoto',
      loadedModifiedTime: 't2',
      dirty: false,
    });
    expect(state.conflict).toEqual({ status: 'none' });
  });
});
