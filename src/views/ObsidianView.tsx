import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { buildNameIndex, computeBacklinks, resolveWikilinkTarget } from '../lib/obsidianBacklinks';
import { normalizeNoteName, stripMdExtension } from '../lib/obsidianWikilink';
import { useDebouncedCallback } from '../lib/useDebouncedCallback';
import { ObsidianEditor } from '../components/ObsidianEditor';
import { ObsidianConflictDialog } from '../components/ObsidianConflictDialog';
import { InlineEdit } from '../components/InlineEdit';

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

// Preserva o padrão de extensão do nome original (ex.: mantém ".md" se já
// tinha) — o usuário só edita o "nome de exibição" no InlineEdit.
function buildRenamedFileName(oldFullName: string, newDisplayName: string): string {
  const match = oldFullName.match(/\.md$/i);
  return match ? `${newDisplayName}${match[0]}` : newDisplayName;
}

function ObsidianVaultBrowser({ uid }: { uid: string }) {
  const vault = useObsidianVault(uid);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [renameStatus, setRenameStatus] = useState<string | null>(null);

  const selectedNote = selectedNoteId ? vault.state.notes.get(selectedNoteId) : null;
  const selectedNoteName = selectedNoteId ? findNodeName(vault.state.folders, selectedNoteId) : undefined;

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
  // sessão (todas as pastas abertas), usado pra resolver wikilinks sem
  // precisar de uma nova busca no Drive quando o alvo já é conhecido.
  const nameIndex = useMemo(() => {
    const allNodes: Array<{ id: string; name: string }> = [];
    for (const folder of vault.state.folders.values()) {
      allNodes.push(...folder.children);
    }
    return buildNameIndex(allNodes);
  }, [vault.state.folders]);

  // Notas com conteúdo já carregado nesta sessão — base do índice de
  // backlinks (limitação consciente da Fase 2: só o que foi visualizado).
  const loadedNoteRefs = useMemo(() => {
    const refs: Array<{ id: string; name: string; content: string }> = [];
    for (const [id, note] of vault.state.notes.entries()) {
      if (note.status !== 'loaded' && note.status !== 'saving') continue;
      const name = findNodeName(vault.state.folders, id);
      if (name) refs.push({ id, name, content: note.content });
    }
    return refs;
  }, [vault.state.notes, vault.state.folders]);

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
      const exact = results.filter(
        (node) => !node.isFolder && normalizeNoteName(node.name) === normalizeNoteName(target),
      );
      if (exact.length === 1) {
        setSelectedNoteId(exact[0].id);
        await vault.openNote(exact[0].id);
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

  return (
    <div className="obsidian-view">
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
