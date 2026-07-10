import { useEffect, useState } from 'react';
import {
  grantDriveAccess,
  hasDriveAccess,
  hasEverConnectedDrive,
  tryRefreshDriveToken,
} from '../lib/googleDrive';
import { isMarkdownFile, type DriveNode } from '../lib/obsidianDrive';
import { DriveFileIcon } from '../lib/driveFileIcons';
import { useObsidianVault, type FolderState } from '../lib/obsidianTree';
import { useDebouncedCallback } from '../lib/useDebouncedCallback';
import { ObsidianEditor } from '../components/ObsidianEditor';
import { ObsidianConflictDialog } from '../components/ObsidianConflictDialog';

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
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const selectedNote = selectedNoteId ? vault.state.notes.get(selectedNoteId) : null;

  useDebouncedCallback(
    () => {
      if (selectedNoteId) void vault.saveNote(selectedNoteId);
    },
    AUTOSAVE_DELAY_MS,
    [selectedNoteId, selectedNote?.content],
  );

  async function openNode(node: DriveNode) {
    if (!isMarkdownFile(node)) return;
    setSelectedNoteId(node.id);
    await vault.openNote(node.id);
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
              <span className="muted">
                {selectedNote.status === 'saving' ? 'Salvando…' : selectedNote.dirty ? 'Alterações não salvas' : 'Salvo'}
              </span>
            </div>
            <ObsidianEditor
              key={selectedNoteId}
              value={selectedNote.content}
              resetKey={`${selectedNoteId}:${selectedNote.loadedModifiedTime}`}
              onChange={(value) => vault.editNote(selectedNoteId, value)}
              onManualSave={() => void vault.saveNote(selectedNoteId)}
            />
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
