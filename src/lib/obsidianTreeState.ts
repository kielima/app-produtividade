import type { DriveNode } from './obsidianNode';

// =========================================================================
// Estado da aba Obsidian — 100% em memória, sem Firestore/IndexedDB (spec
// item 2 e 10: nada é persistido entre sessões; um reload reinicia do zero).
// Chaveado por id (Map), não em árvore aninhada, para que a Fase 3 (grafo
// unificado) possa consumir a mesma estrutura sem reescrever nada.
//
// Este arquivo é só o reducer puro (sem fetch, sem React, sem import de
// googleDrive.ts/firebase.ts) para ser testável isoladamente
// (obsidianTreeState.test.ts) sem precisar mockar rede/Firebase — a mesma
// convenção de driveSyncPlan.ts. Os efeitos de rede ficam em obsidianTree.ts
// (o hook `useObsidianVault`).
// =========================================================================

export type FolderState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  children: DriveNode[];
  error?: string;
};

export type NoteContentState = {
  status: 'idle' | 'loading' | 'loaded' | 'saving' | 'error';
  content: string;
  loadedModifiedTime: string;
  dirty: boolean;
  error?: string;
};

export type ConflictState =
  | { status: 'none' }
  | {
      status: 'comparing';
      fileId: string;
      fileName: string;
      parentFolderId: string;
      localContent: string;
      remoteContent: string;
      remoteModifiedTime: string;
    };

export type VaultState = {
  rootId: string | null;
  folders: Map<string, FolderState>;
  notes: Map<string, NoteContentState>;
  expandedIds: Set<string>;
  conflict: ConflictState;
};

export function initialVaultState(): VaultState {
  return {
    rootId: null,
    folders: new Map(),
    notes: new Map(),
    expandedIds: new Set(),
    conflict: { status: 'none' },
  };
}

export type VaultAction =
  | { type: 'ROOT_SET'; rootId: string }
  | { type: 'FOLDER_LOAD_START'; folderId: string }
  | { type: 'FOLDER_LOADED'; folderId: string; children: DriveNode[] }
  | { type: 'FOLDER_ERROR'; folderId: string; error: string }
  | { type: 'EXPANDED_SET'; folderId: string; expanded: boolean }
  | { type: 'NOTE_LOAD_START'; fileId: string }
  | { type: 'NOTE_LOADED'; fileId: string; content: string; modifiedTime: string }
  | { type: 'NOTE_ERROR'; fileId: string; error: string }
  | { type: 'NOTE_EDIT'; fileId: string; content: string }
  | { type: 'NOTE_SAVE_START'; fileId: string }
  | { type: 'NOTE_SAVED'; fileId: string; modifiedTime: string }
  | { type: 'NOTE_SAVE_ERROR'; fileId: string; error: string }
  | {
      type: 'CONFLICT_DETECTED';
      fileId: string;
      fileName: string;
      parentFolderId: string;
      localContent: string;
      remoteContent: string;
      remoteModifiedTime: string;
    }
  | { type: 'CONFLICT_DISMISSED' }
  | { type: 'NOTE_REPLACE_CONTENT'; fileId: string; content: string; modifiedTime: string };

function updateFolder(
  folders: Map<string, FolderState>,
  folderId: string,
  patch: Partial<FolderState>,
): Map<string, FolderState> {
  const next = new Map(folders);
  const prev = next.get(folderId) ?? { status: 'idle' as const, children: [] };
  next.set(folderId, { ...prev, ...patch });
  return next;
}

function updateNote(
  notes: Map<string, NoteContentState>,
  fileId: string,
  patch: Partial<NoteContentState>,
): Map<string, NoteContentState> {
  const next = new Map(notes);
  const prev = next.get(fileId) ?? {
    status: 'idle' as const,
    content: '',
    loadedModifiedTime: '',
    dirty: false,
  };
  next.set(fileId, { ...prev, ...patch });
  return next;
}

export function obsidianTreeReducer(state: VaultState, action: VaultAction): VaultState {
  switch (action.type) {
    case 'ROOT_SET':
      return { ...state, rootId: action.rootId };
    case 'FOLDER_LOAD_START':
      return {
        ...state,
        folders: updateFolder(state.folders, action.folderId, { status: 'loading' }),
      };
    case 'FOLDER_LOADED':
      return {
        ...state,
        folders: updateFolder(state.folders, action.folderId, {
          status: 'loaded',
          children: action.children,
          error: undefined,
        }),
      };
    case 'FOLDER_ERROR':
      return {
        ...state,
        folders: updateFolder(state.folders, action.folderId, {
          status: 'error',
          error: action.error,
        }),
      };
    case 'EXPANDED_SET': {
      const next = new Set(state.expandedIds);
      if (action.expanded) next.add(action.folderId);
      else next.delete(action.folderId);
      return { ...state, expandedIds: next };
    }
    case 'NOTE_LOAD_START':
      return { ...state, notes: updateNote(state.notes, action.fileId, { status: 'loading' }) };
    case 'NOTE_LOADED':
      return {
        ...state,
        notes: updateNote(state.notes, action.fileId, {
          status: 'loaded',
          content: action.content,
          loadedModifiedTime: action.modifiedTime,
          dirty: false,
          error: undefined,
        }),
      };
    case 'NOTE_ERROR':
      return {
        ...state,
        notes: updateNote(state.notes, action.fileId, { status: 'error', error: action.error }),
      };
    case 'NOTE_EDIT':
      return {
        ...state,
        notes: updateNote(state.notes, action.fileId, { content: action.content, dirty: true }),
      };
    case 'NOTE_SAVE_START':
      return { ...state, notes: updateNote(state.notes, action.fileId, { status: 'saving' }) };
    case 'NOTE_SAVED':
      return {
        ...state,
        notes: updateNote(state.notes, action.fileId, {
          status: 'loaded',
          loadedModifiedTime: action.modifiedTime,
          dirty: false,
        }),
      };
    case 'NOTE_SAVE_ERROR':
      return {
        ...state,
        notes: updateNote(state.notes, action.fileId, { status: 'error', error: action.error }),
      };
    case 'CONFLICT_DETECTED':
      return {
        ...state,
        conflict: {
          status: 'comparing',
          fileId: action.fileId,
          fileName: action.fileName,
          parentFolderId: action.parentFolderId,
          localContent: action.localContent,
          remoteContent: action.remoteContent,
          remoteModifiedTime: action.remoteModifiedTime,
        },
      };
    case 'CONFLICT_DISMISSED':
      return { ...state, conflict: { status: 'none' } };
    case 'NOTE_REPLACE_CONTENT':
      return {
        ...state,
        notes: updateNote(state.notes, action.fileId, {
          status: 'loaded',
          content: action.content,
          loadedModifiedTime: action.modifiedTime,
          dirty: false,
        }),
        conflict: { status: 'none' },
      };
    default:
      return state;
  }
}

export function findNodeName(folders: Map<string, FolderState>, fileId: string): string | undefined {
  for (const folder of folders.values()) {
    const found = folder.children.find((c) => c.id === fileId);
    if (found) return found.name;
  }
  return undefined;
}

export function findParentFolderId(
  folders: Map<string, FolderState>,
  fileId: string,
): string | undefined {
  for (const [folderId, folder] of folders.entries()) {
    if (folder.children.some((c) => c.id === fileId)) return folderId;
  }
  return undefined;
}

export function withConflictSuffix(name: string): string {
  const match = name.match(/\.md$/i);
  if (match) return `${name.slice(0, -match[0].length)} (conflito)${match[0]}`;
  return `${name} (conflito)`;
}
