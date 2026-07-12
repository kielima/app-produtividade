import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  grantDriveAccess,
  hasDriveAccess,
  hasEverConnectedDrive,
  tryRefreshDriveToken,
} from '../lib/googleDrive';
import { isMarkdownFile, type DriveNode } from '../lib/obsidianDrive';
import { DriveFileIcon } from '../lib/driveFileIcons';
import { useObsidianVault } from '../lib/obsidianTree';
import { findNodeName, type FolderState } from '../lib/obsidianTreeState';
import {
  buildNameIndex,
  computeBacklinks,
  filterExactNameMatches,
  resolveWikilinkTarget,
} from '../lib/obsidianBacklinks';
import { buildRenamedFileName, stripMdExtension } from '../lib/obsidianWikilink';
import { useDebouncedCallback } from '../lib/useDebouncedCallback';
import { ObsidianEditor } from '../components/ObsidianEditor';
import { ObsidianConflictDialog } from '../components/ObsidianConflictDialog';
import { ObsidianSearchBox } from '../components/ObsidianSearchBox';
import { SearchToggle } from '../components/SearchBar';
import { InlineEdit } from '../components/InlineEdit';

// Ícones do botão de alternância árvore/grafo — mostram o modo pra ONDE o
// toque leva (não o atual), igual a um botão "ver como X".
function TreeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 4v16M4 5h6M4 12h6M4 19h6M12 5h8M12 12h8M12 19h8" />
    </svg>
  );
}
function GraphIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6" cy="6" r="2.3" />
      <circle cx="18" cy="6" r="2.3" />
      <circle cx="12" cy="18" r="2.3" />
      <path d="M8 6.6h8M7.2 8.2l3.7 8M16.8 8.2l-3.7 8" />
    </svg>
  );
}

// Carregado sob demanda (Suspense abaixo) — o grafo é o modo padrão, então
// esse import roda logo na abertura da aba, mas mantém o code-split do
// react-force-graph-2d fora do bundle principal.
const ObsidianGraphView = lazy(() =>
  import('../components/ObsidianGraphView').then((m) => ({ default: m.ObsidianGraphView })),
);

const AUTOSAVE_DELAY_MS = 2800;

export function ObsidianView({ uid }: { uid: string }) {
  const [connected, setConnected] = useState(() => hasDriveAccess(uid) || hasEverConnectedDrive());
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasDriveAccess(uid) && hasEverConnectedDrive()) {
      void tryRefreshDriveToken(uid).then((tok) => {
        if (tok) setConnected(true);
      });
    }
  }, [uid]);

  async function connect() {
    setConnectError(null);
    try {
      await grantDriveAccess(uid);
      setConnected(true);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!connected) {
    return (
      <div className="obsidian-view obsidian-view--gate">
        <p className="muted">
          Conecte o Google Drive para usar o Google Drive inteiro como vault de notas Markdown.
        </p>
        <button type="button" className="leitura-connect" onClick={() => void connect()}>
          Conectar Google Drive
        </button>
        {connectError && <p className="error">{connectError}</p>}
      </div>
    );
  }

  return <ObsidianVaultBrowser uid={uid} />;
}

function ObsidianVaultBrowser({ uid }: { uid: string }) {
  const vault = useObsidianVault(uid);
  const [mode, setMode] = useState<'tree' | 'graph'>('graph');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [renameStatus, setRenameStatus] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);

  // O alternador árvore/grafo e a busca vivem no topbar do app (mesma barra
  // do botão de menu), não dentro do corpo da aba — igual à busca/filtro das
  // outras abas (ver App.tsx). Como dependem do hook do vault (só criado
  // aqui, depois do "portão" de conexão do Drive), renderizam via portal num
  // slot que o App.tsx já deixa reservado (`#obsidian-topbar-slot`) em vez de
  // subir esse estado todo pra lá.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarSlot(document.getElementById('obsidian-topbar-slot'));
  }, []);

  const selectedNote = selectedNoteId ? vault.state.notes.get(selectedNoteId) : null;
  const selectedNoteName =
    selectedNote?.name || (selectedNoteId ? findNodeName(vault.state.folders, selectedNoteId) : undefined);

  useEffect(() => {
    setLinkWarning(null);
    setRenameStatus(null);
  }, [selectedNoteId]);

  useDebouncedCallback(
    () => {
      if (selectedNoteId) void vault.saveNote(selectedNoteId);
    },
    AUTOSAVE_DELAY_MS,
    [selectedNoteId, selectedNote?.content],
  );

  // Nome normalizado → fileId, construído a partir de tudo já listado nesta
  // sessão (todas as pastas abertas) mais as notas soltas já carregadas
  // (sem pasta conhecida, mas com nome), usado pra resolver wikilinks sem
  // precisar de uma nova busca no Drive quando o alvo já é conhecido.
  const nameIndex = useMemo(() => {
    const allNodes: Array<{ id: string; name: string }> = [];
    for (const folder of vault.state.folders.values()) {
      allNodes.push(...folder.children);
    }
    for (const [id, n] of vault.state.notes.entries()) {
      if (n.parentFolderId === undefined && n.name) allNodes.push({ id, name: n.name });
    }
    return buildNameIndex(allNodes);
  }, [vault.state.folders, vault.state.notes]);

  // Notas com conteúdo já carregado nesta sessão — base do índice de
  // backlinks (limitação consciente da Fase 2: só o que foi visualizado).
  const loadedNoteRefs = useMemo(() => {
    const refs: Array<{ id: string; name: string; content: string }> = [];
    for (const [id, note] of vault.state.notes.entries()) {
      if (note.status !== 'loaded' && note.status !== 'saving') continue;
      if (!note.name) continue;
      refs.push({ id, name: note.name, content: note.content });
    }
    return refs;
  }, [vault.state.notes]);

  const backlinks = useMemo(() => {
    if (!selectedNoteName) return [];
    return computeBacklinks(
      loadedNoteRefs.filter((n) => n.id !== selectedNoteId),
      selectedNoteName,
    );
  }, [loadedNoteRefs, selectedNoteName, selectedNoteId]);

  async function openNode(node: DriveNode) {
    if (!isMarkdownFile(node)) return;
    setSelectedNoteId(node.id);
    await vault.openNote(node.id);
  }

  const handleNavigateWikilink = useCallback(
    async (target: string) => {
      setLinkWarning(null);
      const resolved = resolveWikilinkTarget(nameIndex, target);
      if (resolved) {
        setSelectedNoteId(resolved);
        await vault.openNote(resolved);
        return;
      }
      const results = await vault.searchNotes(target);
      const exact = filterExactNameMatches(results, target);
      if (exact.length === 1) {
        setSelectedNoteId(exact[0].id);
        await vault.openNote(exact[0].id, { name: exact[0].name });
        return;
      }
      setLinkWarning(
        exact.length === 0
          ? `Nenhuma nota chamada "${target}" foi encontrada no Drive.`
          : `Mais de uma nota chamada "${target}" foi encontrada no Drive — abra manualmente pela árvore.`,
      );
    },
    [nameIndex, vault],
  );

  // Clique em resultado de nota na busca geral (Fase 4) — mesmo caminho já
  // usado pelo fallback de wikilink não resolvido (openNote sem pasta-mãe
  // conhecida); troca pra árvore caso a busca tenha sido usada no grafo.
  function handleOpenSearchNote(node: DriveNode) {
    setSearchStatus(null);
    setSelectedNoteId(node.id);
    setMode('tree');
    void vault.openNote(node.id, { name: node.name });
  }

  // Pastas achadas pela busca geral podem estar em qualquer lugar do Drive,
  // não só sob a raiz — a árvore só mostra o que é alcançável a partir dela,
  // então não tenta navegar até lá. O grafo já mostra qualquer pasta
  // carregada+expandida como cluster próprio, alcançável ou não (mesmo
  // mecanismo que já exibe a pasta "Computadores" desconectada), sem precisar
  // de nenhuma lógica nova.
  function handleOpenSearchFolder(node: DriveNode) {
    setSearchStatus(`Pasta "${node.name}" aberta no grafo.`);
    setMode('graph');
    void vault.expandFolder(node.id);
  }

  async function handleRename(newDisplayName: string) {
    if (!selectedNoteId || !selectedNoteName) return;
    const newFullName = buildRenamedFileName(selectedNoteName, newDisplayName);
    if (newFullName === selectedNoteName) return;
    setRenameStatus('Renomeando…');
    try {
      const outcome = await vault.renameNote(selectedNoteId, selectedNoteName, newFullName);
      setRenameStatus(
        outcome.updatedCount > 0
          ? `Renomeado. ${outcome.updatedCount} nota${outcome.updatedCount === 1 ? '' : 's'} atualizada${outcome.updatedCount === 1 ? '' : 's'}.`
          : 'Renomeado.',
      );
    } catch (e) {
      setRenameStatus(`Erro ao renomear: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const conflict = vault.state.conflict;

  const topbarControls = (
    <>
      {searchExpanded ? (
        <ObsidianSearchBox
          searchVaultWide={vault.searchVaultWide}
          onOpenNote={handleOpenSearchNote}
          onOpenFolder={handleOpenSearchFolder}
          onClose={() => setSearchExpanded(false)}
        />
      ) : (
        <>
          <button
            type="button"
            className="obsidian-mode-toggle-btn"
            onClick={() => setMode(mode === 'tree' ? 'graph' : 'tree')}
            aria-label={mode === 'tree' ? 'Ver como grafo' : 'Ver como árvore'}
            title={mode === 'tree' ? 'Ver como grafo' : 'Ver como árvore'}
          >
            {mode === 'tree' ? <GraphIcon /> : <TreeIcon />}
          </button>
          <SearchToggle active={false} onClick={() => setSearchExpanded(true)} />
        </>
      )}
    </>
  );

  return (
    <div className="obsidian-view">
      {topbarSlot && createPortal(topbarControls, topbarSlot)}
      {searchStatus && <p className="muted obsidian-status-line">{searchStatus}</p>}

      {mode === 'tree' ? (
        <div className="obsidian-view-body">
          <aside className="obsidian-tree" aria-label="Pastas e notas do Drive">
            {vault.state.rootId && (
              <FolderChildren
                folderId={vault.state.rootId}
                depth={0}
                folders={vault.state.folders}
                expandedIds={vault.state.expandedIds}
                selectedNoteId={selectedNoteId}
                onToggleFolder={(id, expanded) =>
                  expanded ? vault.collapseFolder(id) : void vault.expandFolder(id)
                }
                onOpenNode={openNode}
              />
            )}
          </aside>

          <section className="obsidian-editor-pane">
            {!selectedNoteId && <p className="muted">Selecione uma nota .md para editar.</p>}
            {selectedNoteId && selectedNote?.status === 'loading' && <p className="muted">Carregando…</p>}
            {selectedNoteId && selectedNote?.status === 'error' && (
              <p className="error">{selectedNote.error}</p>
            )}
            {selectedNoteId && selectedNote && (selectedNote.status === 'loaded' || selectedNote.status === 'saving') && (
              <>
                <div className="obsidian-editor-toolbar">
                  <InlineEdit
                    value={stripMdExtension(selectedNoteName ?? '')}
                    onSave={(next) => void handleRename(next)}
                    className="obsidian-note-title"
                    ariaLabel="renomear nota"
                  />
                  <span className="muted">
                    {selectedNote.status === 'saving' ? 'Salvando…' : selectedNote.dirty ? 'Alterações não salvas' : 'Salvo'}
                  </span>
                </div>
                {renameStatus && <p className="muted obsidian-status-line">{renameStatus}</p>}
                <ObsidianEditor
                  key={selectedNoteId}
                  value={selectedNote.content}
                  resetKey={`${selectedNoteId}:${selectedNote.loadedModifiedTime}`}
                  onChange={(value) => vault.editNote(selectedNoteId, value)}
                  onManualSave={() => void vault.saveNote(selectedNoteId)}
                  onSearchNotes={(query) => vault.searchNotes(query)}
                  onNavigateWikilink={(target) => void handleNavigateWikilink(target)}
                />
                {linkWarning && <p className="error obsidian-status-line">{linkWarning}</p>}
                <section className="obsidian-backlinks" aria-label="Notas que citam esta nota">
                  <h3>Backlinks</h3>
                  {backlinks.length === 0 ? (
                    <p className="muted">Nenhuma nota carregada nesta sessão cita esta.</p>
                  ) : (
                    <ul>
                      {backlinks.map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            className="obsidian-backlink-item"
                            onClick={() => {
                              setSelectedNoteId(b.id);
                              void vault.openNote(b.id);
                            }}
                          >
                            {b.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="obsidian-view-body">
          <Suspense fallback={<p className="muted">Carregando grafo…</p>}>
            <ObsidianGraphView
              vault={vault}
              onEditNote={(fileId) => {
                setSelectedNoteId(fileId);
                setMode('tree');
              }}
              onNodeDeleted={(fileId) => {
                if (fileId === selectedNoteId) setSelectedNoteId(null);
              }}
            />
          </Suspense>
        </div>
      )}

      {conflict.status === 'comparing' && (
        <ObsidianConflictDialog
          conflict={conflict}
          onKeepMine={() => void vault.resolveKeepMine(conflict.fileId)}
          onUseRemote={() => vault.resolveUseRemote(conflict.fileId)}
          onKeepBoth={() => void vault.resolveKeepBoth(conflict.fileId)}
        />
      )}
    </div>
  );
}

function FolderChildren({
  folderId,
  depth,
  folders,
  expandedIds,
  selectedNoteId,
  onToggleFolder,
  onOpenNode,
}: {
  folderId: string;
  depth: number;
  folders: Map<string, FolderState>;
  expandedIds: Set<string>;
  selectedNoteId: string | null;
  onToggleFolder: (folderId: string, expanded: boolean) => void;
  onOpenNode: (node: DriveNode) => void;
}) {
  const folder = folders.get(folderId);
  if (!folder) return null;
  if (folder.status === 'loading') {
    return <p className="muted obsidian-tree-status" style={{ paddingLeft: depth * 16 }}>Carregando…</p>;
  }
  if (folder.status === 'error') {
    return <p className="error obsidian-tree-status" style={{ paddingLeft: depth * 16 }}>{folder.error}</p>;
  }

  return (
    <ul className="obsidian-tree-list">
      {folder.children.map((child) => {
        const expanded = expandedIds.has(child.id);
        return (
          <li key={child.id} style={{ paddingLeft: depth * 16 }}>
            {child.isFolder ? (
              <>
                <button
                  type="button"
                  className="obsidian-tree-row obsidian-tree-row--folder"
                  onClick={() => onToggleFolder(child.id, expanded)}
                  aria-expanded={expanded}
                >
                  <DriveFileIcon node={child} />
                  <span>{child.name}</span>
                </button>
                {expanded && (
                  <FolderChildren
                    folderId={child.id}
                    depth={depth + 1}
                    folders={folders}
                    expandedIds={expandedIds}
                    selectedNoteId={selectedNoteId}
                    onToggleFolder={onToggleFolder}
                    onOpenNode={onOpenNode}
                  />
                )}
              </>
            ) : (
              <button
                type="button"
                className={`obsidian-tree-row${selectedNoteId === child.id ? ' active' : ''}${
                  isMarkdownFile(child) ? '' : ' obsidian-tree-row--readonly'
                }`}
                onClick={() => onOpenNode(child)}
                disabled={!isMarkdownFile(child)}
              >
                <DriveFileIcon node={child} />
                <span>{child.name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
