import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  createMarkdownFile,
  ensureDriveToken,
  getFileModifiedTime,
  getRootFolderId,
  isMarkdownFile,
  listFolderChildren,
  listStarredItems,
  readBinaryContent,
  readMarkdownContent,
  searchFilesByName,
  searchFilesContainingText,
  writeMarkdownContent,
  type DriveNode,
} from './grafosDrive';
import { moveDriveFile, renameDriveFile, trashDriveFile } from './googleDrive';
import { hasConflict } from './grafosConflict';
import { renameNoteAndFixLinks, type RenameOutcome } from './grafosRename';
import {
  CONTENT_SEARCH_MAX_RESULTS,
  MIN_SEARCH_QUERY_LENGTH,
  dedupeContentMatches,
} from './grafosSearch';
import {
  findNodeName,
  findParentFolderId,
  initialVaultState,
  grafosTreeReducer,
  withConflictSuffix,
} from './grafosTreeState';

export type {
  ConflictState,
  FolderState,
  NoteContentState,
  VaultAction,
  VaultState,
} from './grafosTreeState';

export type SaveOutcome = 'saved' | 'conflict' | 'error' | 'noop';

// Hook que compõe o reducer puro de grafosTreeState.ts com os efeitos de
// rede (Drive). Mantido separado de src/views/GrafosView.tsx para o
// componente ficar fino, e separado do reducer puro para este poder ser
// testado sem montar nada em jsdom nem tocar Firebase (ver
// grafosTreeState.test.ts).
export function useGrafosVault(uid: string) {
  const [state, dispatch] = useReducer(grafosTreeReducer, undefined, initialVaultState);
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

  // Busca crua (Drive + favoritos mesclados) — extraído do corpo de
  // `loadFolder` pra ser reaproveitado por `refreshFolderSilently` abaixo,
  // que precisa do MESMO merge mas SEM os dispatches de
  // `FOLDER_LOAD_START`/`FOLDER_ERROR` em volta (ver comentário lá).
  const fetchFolderChildren = useCallback(
    async (folderId: string, includeStarred: boolean): Promise<DriveNode[]> => {
      const token = await getToken();
      const [children, starredItems] = await Promise.all([
        listFolderChildren(token, folderId),
        includeStarred ? listStarredItems(token) : Promise.resolve([]),
      ]);
      const seenIds = new Set(children.map((c) => c.id));
      return starredItems.length > 0
        ? [...children, ...starredItems.filter((f) => !seenIds.has(f.id))]
        : children;
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
  // Devolve os `children` carregados (além de despachar no reducer) — usado
  // por `loadFolderChildren` abaixo, que precisa do resultado imediato pra
  // alimentar o crawl recursivo do sistema solar sem depender de reler
  // `stateRef` logo após um dispatch (risco de leitura defasada antes do
  // próximo render). Nenhum chamador existente usava o retorno antes desta
  // mudança, então é uma alteração aditiva.
  const loadFolder = useCallback(
    async (
      folderId: string,
      opts: { fetchNoteContent: boolean; includeStarred?: boolean },
    ): Promise<DriveNode[] | undefined> => {
      dispatch({ type: 'FOLDER_LOAD_START', folderId });
      try {
        const combined = await fetchFolderChildren(folderId, !!opts.includeStarred);
        dispatch({ type: 'FOLDER_LOADED', folderId, children: combined });
        if (opts.fetchNoteContent) {
          const markdownChildren = combined.filter((c) => !c.isFolder && isMarkdownFile(c));
          await Promise.all(
            markdownChildren.map((child) =>
              loadNoteContent(child.id, { name: child.name, parentFolderId: folderId }),
            ),
          );
        }
        return combined;
      } catch (e) {
        dispatch({ type: 'FOLDER_ERROR', folderId, error: e instanceof Error ? e.message : String(e) });
        return undefined;
      }
    },
    [fetchFolderChildren, loadNoteContent],
  );

  // Recarrega uma pasta JÁ carregada sem passar por `status: 'loading'`/
  // `'error'` — usado pelo botão "Atualizar" do sistema solar
  // (GrafosSolarSystemView.tsx) pra buscar mudanças feitas fora do app
  // (direto no Drive) SEM perturbar a visualização em andamento. `loadFolder`
  // dispatcha `FOLDER_LOAD_START` antes de buscar, o que passa `status` pra
  // 'loading' — `buildSolarSystemData` (grafosSolarSystem.ts) só visita
  // pastas com `status === 'loaded'`, então QUALQUER pasta nesse estado
  // "loading" (por mais breve que seja) faz sua subárvore inteira sumir do
  // mapa até a busca terminar, e reaparecer como nó "novo" (ângulo
  // orbital resetado, câmera parando de seguir se o nó seguido for um
  // deles) — inaceitável quando o refresh mexe em DEZENAS de pastas em
  // paralelo (ver refreshLoadedFolders no componente). Por isso: nenhum
  // dispatch de "iniciando"; e em caso de erro, mantém os dados antigos
  // (não marca como 'error', que teria o mesmo efeito de esconder a
  // subárvore) — falha nessa pasta específica só significa "continua com o
  // que já tínhamos", sem quebrar o resto do refresh.
  const refreshFolderSilently = useCallback(
    async (folderId: string): Promise<DriveNode[] | undefined> => {
      try {
        const combined = await fetchFolderChildren(folderId, folderId === stateRef.current.rootId);
        dispatch({ type: 'FOLDER_LOADED', folderId, children: combined });
        return combined;
      } catch {
        return undefined;
      }
    },
    [fetchFolderChildren],
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

  // Recarrega uma pasta já carregada (depois de renomear/mover/excluir algo
  // dentro dela, ou resolver um conflito) — sempre reincluindo favoritos
  // (`includeStarred`) quando a pasta é a RAIZ do vault. Sem isso, um reload
  // "genérico" da raiz (a maioria dos que este arquivo faz) sobrescreveria
  // `state.folders` da raiz só com os filhos "de verdade" dela, perdendo o
  // merge de itens favoritados feito no carregamento inicial (spec item 3)
  // — um item favoritado (ex.: uma pasta de topo que só aparece por estar
  // favoritada, não por ser filha de verdade de "Meu Drive") sumiria da
  // árvore/grafo mesmo continuando favoritado no Drive, exatamente o "a
  // pasta renomeada está sumindo" relatado pelo usuário.
  const reloadFolder = useCallback(
    (folderId: string) =>
      loadFolder(folderId, {
        fetchNoteContent: false,
        includeStarred: folderId === stateRef.current.rootId,
      }),
    [loadFolder],
  );

  // Carregamento "raso" (sem conteúdo de nota, sem marcar como expandida) —
  // usado pelo crawl eager do sistema solar (GrafosSolarSystemView.tsx),
  // que precisa da listagem de filhos de TODA pasta do vault pra montar o
  // mapa orbital completo, mas não do texto de cada nota (essa visualização
  // não faz parsing de wikilink) nem de marcar nada como "expandido" —
  // `expandedIds` continua controlando só a árvore/grafo, sem esse método
  // interferir no comportamento preguiçoso deles. Cache-aware: se a pasta já
  // foi carregada por qualquer caminho (árvore, grafo, ou uma chamada
  // anterior daqui), devolve os filhos do cache sem nova requisição.
  //
  // Devolve `undefined` (não `[]`) quando a busca falha — distinção que o
  // chamador precisa pra decidir se tenta de novo: `[]` é uma pasta
  // genuinamente vazia, `undefined` é uma falha transitória (rate limit,
  // erro 500 "internal" etc.) que pode valer a pena repetir. Antes desta
  // mudança os dois casos eram indistinguíveis (`children ?? []`), o que
  // impedia qualquer retry no crawl eager.
  const loadFolderChildren = useCallback(
    async (folderId: string): Promise<DriveNode[] | undefined> => {
      const existing = stateRef.current.folders.get(folderId);
      if (existing && existing.status === 'loaded') return existing.children;
      return loadFolder(folderId, {
        fetchNoteContent: false,
        includeStarred: folderId === stateRef.current.rootId,
      });
    },
    [loadFolder],
  );

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
      await reloadFolder(conflict.parentFolderId);
    },
    [getToken, reloadFolder],
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

  // Conteúdo binário bruto (imagens, PDFs) pro preview inline no grafo —
  // mesmo token/fluxo dos demais acessos ao Drive, sem passar por
  // `state.notes` (que só guarda texto de notas Markdown).
  const readFilePreview = useCallback(
    async (fileId: string): Promise<ArrayBuffer> => {
      const token = await getToken();
      return readBinaryContent(token, fileId);
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
      if (parentFolderId) await reloadFolder(parentFolderId);
      return outcome;
    },
    [uid, reloadFolder],
  );

  // Renomeia uma pasta ou um arquivo não-Markdown — sem corrigir wikilinks
  // (só notas .md são citadas por `[[wikilinks]]`, ver renameNote acima).
  // Usado pelo menu de contexto do grafo (segurar em cima de um nó).
  const renameFolderOrFile = useCallback(
    async (fileId: string, newName: string): Promise<void> => {
      await renameDriveFile(uid, fileId, newName);
      const parentFolderId = findParentFolderId(stateRef.current.folders, fileId);
      if (parentFolderId) await reloadFolder(parentFolderId);
    },
    [uid, reloadFolder],
  );

  // Move uma pasta/nota/arquivo de uma pasta-mãe pra outra (menu de contexto
  // do grafo). Recarrega as duas pastas — a antiga (pro item sumir de lá) e a
  // nova (pro item aparecer lá, se ela já estiver carregada nesta sessão; se
  // ainda não foi aberta, ela vai buscar tudo — inclusive o item movido — na
  // próxima vez que for expandida, sem precisar de nenhum código extra aqui).
  // Se o item movido for uma nota já carregada, seu `parentFolderId` em
  // `state.notes` também precisa ser corrigido — do contrário um rename ou
  // save posterior consultaria a pasta-mãe ERRADA (a antiga).
  const moveNode = useCallback(
    async (fileId: string, oldParentId: string, newParentId: string): Promise<void> => {
      await moveDriveFile(uid, fileId, oldParentId, newParentId);
      if (stateRef.current.notes.has(fileId)) {
        dispatch({ type: 'NOTE_PARENT_UPDATED', fileId, parentFolderId: newParentId });
      }
      await Promise.all([reloadFolder(oldParentId), reloadFolder(newParentId)]);
    },
    [uid, reloadFolder],
  );

  // Manda uma nota/arquivo pra lixeira do Drive (recuperável por lá) — menu
  // de contexto do grafo só oferece isto pra nota/arquivo, nunca pra pasta
  // (evita apagar uma subárvore inteira sem querer). Recarregar a pasta-mãe
  // já basta pra ela sumir da árvore/grafo (consultas já filtram trashed).
  const deleteFile = useCallback(
    async (fileId: string): Promise<void> => {
      await trashDriveFile(uid, fileId);
      dispatch({ type: 'NOTE_REMOVED', fileId });
      const parentFolderId = findParentFolderId(stateRef.current.folders, fileId);
      if (parentFolderId) await reloadFolder(parentFolderId);
    },
    [uid, reloadFolder],
  );

  return {
    state,
    expandFolder,
    collapseFolder,
    loadFolderChildren,
    refreshFolderSilently,
    openNote,
    editNote,
    saveNote,
    resolveKeepMine,
    resolveUseRemote,
    resolveKeepBoth,
    searchNotes,
    searchVaultWide,
    readFilePreview,
    renameNote,
    renameFolderOrFile,
    moveNode,
    deleteFile,
  };
}
