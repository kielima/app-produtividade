import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  createMarkdownFile,
  ensureDriveToken,
  getFileModifiedTime,
  getRootFolderId,
  isMarkdownFile,
  listFolderChildren,
  listStarredItems,
  readMarkdownContent,
  searchFilesByName,
  searchFilesContainingText,
  writeMarkdownContent,
  type DriveNode,
} from './obsidianDrive';
import { hasConflict } from './obsidianConflict';
import { renameNoteAndFixLinks, type RenameOutcome } from './obsidianRename';
import {
  CONTENT_SEARCH_MAX_RESULTS,
  MIN_SEARCH_QUERY_LENGTH,
  dedupeContentMatches,
} from './obsidianSearch';
import {
  findNodeName,
  findParentFolderId,
  initialVaultState,
  obsidianTreeReducer,
  withConflictSuffix,
} from './obsidianTreeState';

export type {
  ConflictState,
  FolderState,
  NoteContentState,
  VaultAction,
  VaultState,
} from './obsidianTreeState';

export type SaveOutcome = 'saved' | 'conflict' | 'error' | 'noop';

// Hook que compõe o reducer puro de obsidianTreeState.ts com os efeitos de
// rede (Drive). Mantido separado de src/views/ObsidianView.tsx para o
// componente ficar fino, e separado do reducer puro para este poder ser
// testado sem montar nada em jsdom nem tocar Firebase (ver
// obsidianTreeState.test.ts).
export function useObsidianVault(uid: string) {
  const [state, dispatch] = useReducer(obsidianTreeReducer, undefined, initialVaultState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getToken = useCallback(() => ensureDriveToken(uid), [uid]);

  // `meta` evita reescanear `state.folders` quando quem chama já tem o
  // DriveNode em mãos (ex.: um filho de pasta já listado, ou um resultado de
  // busca) — cai no escaneamento antigo (findNodeName/findParentFolderId)
  // como fallback pra chamadas que não têm essa informação de prontidão.
  const loadNoteContent = useCallback(
    async (fileId: string, meta?: { name: string; parentFolderId?: string }) => {
      const name = meta?.name ?? findNodeName(stateRef.current.folders, fileId) ?? '';
      const parentFolderId = meta?.parentFolderId ?? findParentFolderId(stateRef.current.folders, fileId);
      dispatch({ type: 'NOTE_LOAD_START', fileId, name, parentFolderId });
      try {
        const token = await getToken();
        const [content, modifiedTime] = await Promise.all([
          readMarkdownContent(token, fileId),
          getFileModifiedTime(token, fileId),
        ]);
        dispatch({ type: 'NOTE_LOADED', fileId, content, modifiedTime });
      } catch (e) {
        dispatch({ type: 'NOTE_ERROR', fileId, error: e instanceof Error ? e.message : String(e) });
      }
    },
    [getToken],
  );

  // `fetchNoteContent` distingue o pré-carregamento inicial da raiz (spec
  // item 1: só nomes/metadados) de uma expansão explícita de subpasta (spec
  // item 2: nomes + conteúdo de todas as notas .md daquela pasta).
  // `includeStarred` só é usado no carregamento da raiz: além dos filhos
  // diretos, busca itens marcados como favoritos (⭐) no Drive e mescla na
  // listagem — é como o usuário torna visível algo que não está alcançável
  // navegando a partir da raiz (ex.: a seção "Computadores" do Drive).
  const loadFolder = useCallback(
    async (folderId: string, opts: { fetchNoteContent: boolean; includeStarred?: boolean }) => {
      dispatch({ type: 'FOLDER_LOAD_START', folderId });
      try {
        const token = await getToken();
        const [children, starredItems] = await Promise.all([
          listFolderChildren(token, folderId),
          opts.includeStarred ? listStarredItems(token) : Promise.resolve([]),
        ]);
        const seenIds = new Set(children.map((c) => c.id));
        const combined =
          starredItems.length > 0
            ? [...children, ...starredItems.filter((f) => !seenIds.has(f.id))]
            : children;
        dispatch({ type: 'FOLDER_LOADED', folderId, children: combined });
        if (opts.fetchNoteContent) {
          const markdownChildren = combined.filter((c) => !c.isFolder && isMarkdownFile(c));
          await Promise.all(
            markdownChildren.map((child) =>
              loadNoteContent(child.id, { name: child.name, parentFolderId: folderId }),
            ),
          );
        }
      } catch (e) {
        dispatch({ type: 'FOLDER_ERROR', folderId, error: e instanceof Error ? e.message : String(e) });
      }
    },
    [getToken, loadNoteContent],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rootId = await getRootFolderId();
      if (cancelled) return;
      dispatch({ type: 'ROOT_SET', rootId });
      dispatch({ type: 'EXPANDED_SET', folderId: rootId, expanded: true });
      await loadFolder(rootId, { fetchNoteContent: false, includeStarred: true });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const expandFolder = useCallback(
    async (folderId: string) => {
      dispatch({ type: 'EXPANDED_SET', folderId, expanded: true });
      const existing = stateRef.current.folders.get(folderId);
      if (existing && existing.status !== 'idle' && existing.status !== 'error') return;
      await loadFolder(folderId, { fetchNoteContent: true });
    },
    [loadFolder],
  );

  const collapseFolder = useCallback((folderId: string) => {
    dispatch({ type: 'EXPANDED_SET', folderId, expanded: false });
  }, []);

  // Abre uma nota fora do fluxo normal de expansão — ex.: um .md direto na
  // raiz (spec item 1), ou uma nota "solta" resolvida por busca (Fase 2/3),
  // que não pertence a nenhuma pasta conhecida — por isso `meta` é como o
  // chamador informa o nome (e, quando souber, a pasta-mãe) de antemão.
  const openNote = useCallback(
    async (fileId: string, meta?: { name: string; parentFolderId?: string }) => {
      const existing = stateRef.current.notes.get(fileId);
      if (existing && (existing.status === 'loaded' || existing.status === 'loading')) return;
      await loadNoteContent(fileId, meta);
    },
    [loadNoteContent],
  );

  const editNote = useCallback((fileId: string, content: string) => {
    dispatch({ type: 'NOTE_EDIT', fileId, content });
  }, []);

  // Fluxo único de checagem-de-conflito-e-escrita — usado tanto pelo
  // autosave (debounce) quanto por um botão manual "salvar agora", pra não
  // ter dois caminhos que possam divergir.
  const saveNote = useCallback(
    async (fileId: string): Promise<SaveOutcome> => {
      const note = stateRef.current.notes.get(fileId);
      if (!note || !note.dirty) return 'noop';
      dispatch({ type: 'NOTE_SAVE_START', fileId });
      try {
        const token = await getToken();
        const remoteModifiedTime = await getFileModifiedTime(token, fileId);
        if (hasConflict(note.loadedModifiedTime, remoteModifiedTime)) {
          const remoteContent = await readMarkdownContent(token, fileId);
          const fileName = note.name || fileId;
          const parentFolderId =
            note.parentFolderId ?? findParentFolderId(stateRef.current.folders, fileId) ?? stateRef.current.rootId ?? '';
          dispatch({
            type: 'CONFLICT_DETECTED',
            fileId,
            fileName,
            parentFolderId,
            localContent: note.content,
            remoteContent,
            remoteModifiedTime,
          });
          return 'conflict';
        }
        const { modifiedTime } = await writeMarkdownContent(token, fileId, note.content);
        dispatch({ type: 'NOTE_SAVED', fileId, modifiedTime });
        return 'saved';
      } catch (e) {
        dispatch({ type: 'NOTE_SAVE_ERROR', fileId, error: e instanceof Error ? e.message : String(e) });
        return 'error';
      }
    },
    [getToken],
  );

  // Resoluções do diálogo de conflito: manter a minha (sobrescreve), usar a
  // do Drive (descarta local) ou manter as duas (salva a local como cópia).
  const resolveKeepMine = useCallback(
    async (fileId: string) => {
      const note = stateRef.current.notes.get(fileId);
      if (!note) return;
      const token = await getToken();
      const { modifiedTime } = await writeMarkdownContent(token, fileId, note.content);
      dispatch({ type: 'NOTE_SAVED', fileId, modifiedTime });
      dispatch({ type: 'CONFLICT_DISMISSED' });
    },
    [getToken],
  );

  const resolveUseRemote = useCallback((fileId: string) => {
    const conflict = stateRef.current.conflict;
    if (conflict.status !== 'comparing' || conflict.fileId !== fileId) return;
    dispatch({
      type: 'NOTE_REPLACE_CONTENT',
      fileId,
      content: conflict.remoteContent,
      modifiedTime: conflict.remoteModifiedTime,
    });
  }, []);

  const resolveKeepBoth = useCallback(
    async (fileId: string) => {
      const conflict = stateRef.current.conflict;
      if (conflict.status !== 'comparing' || conflict.fileId !== fileId) return;
      const token = await getToken();
      const copyName = withConflictSuffix(conflict.fileName);
      const created = await createMarkdownFile(token, conflict.parentFolderId, copyName);
      await writeMarkdownContent(token, created.id, conflict.localContent);
      dispatch({
        type: 'NOTE_REPLACE_CONTENT',
        fileId,
        content: conflict.remoteContent,
        modifiedTime: conflict.remoteModifiedTime,
      });
      await loadFolder(conflict.parentFolderId, { fetchNoteContent: false });
    },
    [getToken, loadFolder],
  );

  // Busca por nome no Drive inteiro (spec item 5) — autocomplete de `[[` e
  // resolução de clique num link ainda não carregado nesta sessão.
  const searchNotes = useCallback(
    async (query: string): Promise<DriveNode[]> => {
      const token = await getToken();
      return searchFilesByName(token, query);
    },
    [getToken],
  );

  // Busca geral da aba (Fase 4/spec item 6-7) — por nome E por conteúdo, em
  // todo o Drive, não só o que já foi carregado nesta sessão. Devolve dois
  // grupos rotulados em vez de uma lista única "ranqueada": o Drive não dá
  // nenhum score de relevância pra `fullText contains`, então fingir uma
  // ordenação única seria enganoso.
  const searchVaultWide = useCallback(
    async (query: string): Promise<{ byName: DriveNode[]; byContent: DriveNode[] }> => {
      const trimmed = query.trim();
      if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) return { byName: [], byContent: [] };
      const token = await getToken();
      const [byName, byContent] = await Promise.all([
        searchFilesByName(token, trimmed),
        searchFilesContainingText(token, trimmed, CONTENT_SEARCH_MAX_RESULTS),
      ]);
      return { byName, byContent: dedupeContentMatches(byName, byContent) };
    },
    [getToken],
  );

  // Renomeia a nota selecionada e corrige os wikilinks que a citam em
  // qualquer lugar do Drive (spec item 7); depois recarrega a pasta-mãe pra
  // a árvore refletir o nome novo. Notas "soltas" (sem pasta-mãe conhecida)
  // não recarregam nada — não há árvore visível pra atualizar.
  const renameNote = useCallback(
    async (fileId: string, oldName: string, newName: string): Promise<RenameOutcome> => {
      const outcome = await renameNoteAndFixLinks(uid, fileId, oldName, newName);
      const parentFolderId =
        stateRef.current.notes.get(fileId)?.parentFolderId ?? findParentFolderId(stateRef.current.folders, fileId);
      if (parentFolderId) await loadFolder(parentFolderId, { fetchNoteContent: false });
      return outcome;
    },
    [uid, loadFolder],
  );

  return {
    state,
    expandFolder,
    collapseFolder,
    openNote,
    editNote,
    saveNote,
    resolveKeepMine,
    resolveUseRemote,
    resolveKeepBoth,
    searchNotes,
    searchVaultWide,
    renameNote,
  };
}
