import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  grantDriveAccess,
  hasDriveAccess,
  hasEverConnectedDrive,
  tryRefreshDriveToken,
} from '../lib/googleDrive';
import type { DriveNode } from '../lib/grafosDrive';
import { useGrafosVault } from '../lib/grafosTree';
import { findNodeName } from '../lib/grafosTreeState';
import {
  buildNameIndex,
  computeBacklinks,
  filterExactNameMatches,
  resolveWikilinkTarget,
} from '../lib/grafosBacklinks';
import { buildRenamedFileName, stripMdExtension } from '../lib/grafosWikilink';
import { useDebouncedCallback } from '../lib/useDebouncedCallback';
import { GrafosEditor } from '../components/GrafosEditor';
import { GrafosConflictDialog } from '../components/GrafosConflictDialog';
import { GrafosSearchBox } from '../components/GrafosSearchBox';
import { SearchToggle } from '../components/SearchBar';
import { InlineEdit } from '../components/InlineEdit';
import { GrafosViewErrorBoundary } from '../components/GrafosViewErrorBoundary';

// Ícones do botão de alternância grafo/órbitas — mostram o modo pra ONDE o
// toque leva (não o atual), igual a um botão "ver como X".
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
function SolarIcon() {
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
      <circle cx="12" cy="12" r="2.4" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(25 12 12)" />
      <circle cx="19.2" cy="9.9" r="1.3" />
    </svg>
  );
}

// Alvo do toggle: o ícone mostrado é sempre o do modo PRA ONDE o clique leva.
const MODE_TOGGLE_TARGET: Record<'graph' | 'solar', { key: 'graph' | 'solar'; label: string; icon: JSX.Element }> = {
  solar: { key: 'graph', label: 'Ver como grafo', icon: <GraphIcon /> },
  graph: { key: 'solar', label: 'Ver órbitas', icon: <SolarIcon /> },
};

// Carregado sob demanda (Suspense abaixo) — mantém o code-split do
// react-force-graph-2d fora do bundle principal.
const GrafosGraphView = lazy(() =>
  import('../components/GrafosGraphView').then((m) => ({ default: m.GrafosGraphView })),
);
// Sistema solar (órbitas) é o modo padrão da aba, então esse import roda
// logo na abertura. Mesmo code-split do grafo — canvas cru, sem
// react-force-graph-2d (ver grafosColors.ts, extraído justamente pra essas
// duas visualizações não se acoplarem no bundle uma da outra).
const GrafosSolarSystemView = lazy(() =>
  import('../components/GrafosSolarSystemView').then((m) => ({ default: m.GrafosSolarSystemView })),
);

const AUTOSAVE_DELAY_MS = 2800;

export function GrafosView({ uid }: { uid: string }) {
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
      <div className="grafos-view grafos-view--gate">
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

  return <GrafosVaultBrowser uid={uid} />;
}

function GrafosVaultBrowser({ uid }: { uid: string }) {
  const vault = useGrafosVault(uid);
  // Órbitas é o modo padrão ao abrir a aba — o grafo é a alternativa (ver
  // MODE_TOGGLE_TARGET), a árvore de pastas foi removida como visualização.
  const [mode, setMode] = useState<'graph' | 'solar'>('solar');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [renameStatus, setRenameStatus] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);

  // O alternador grafo/órbitas e a busca vivem no topbar do app (mesma barra
  // do botão de menu), não dentro do corpo da aba — igual à busca/filtro das
  // outras abas (ver App.tsx). Como dependem do hook do vault (só criado
  // aqui, depois do "portão" de conexão do Drive), renderizam via portal num
  // slot que o App.tsx já deixa reservado (`#grafos-topbar-slot`) em vez de
  // subir esse estado todo pra lá.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarSlot(document.getElementById('grafos-topbar-slot'));
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
          : `Mais de uma nota chamada "${target}" foi encontrada no Drive — abra manualmente pela busca.`,
      );
    },
    [nameIndex, vault],
  );

  // Clique em resultado de nota na busca geral (Fase 4) — mesmo caminho já
  // usado pelo fallback de wikilink não resolvido (openNote sem pasta-mãe
  // conhecida); a nota abre no editor sobreposto, sem trocar o modo de
  // visualização atual (grafo ou órbitas).
  function handleOpenSearchNote(node: DriveNode) {
    setSearchStatus(null);
    setSelectedNoteId(node.id);
    void vault.openNote(node.id, { name: node.name });
  }

  // Pastas achadas pela busca geral podem estar em qualquer lugar do Drive,
  // não só sob a raiz. O grafo e o sistema solar já mostram qualquer pasta
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
        <GrafosSearchBox
          searchVaultWide={vault.searchVaultWide}
          onOpenNote={handleOpenSearchNote}
          onOpenFolder={handleOpenSearchFolder}
          onClose={() => setSearchExpanded(false)}
        />
      ) : (
        <>
          {/* Botão toggle único — o ícone mostra o modo PRA ONDE o toque
              leva (não o atual), igual ao antigo cíclico binário. */}
          <button
            type="button"
            className="grafos-mode-toggle-btn"
            aria-label={MODE_TOGGLE_TARGET[mode].label}
            title={MODE_TOGGLE_TARGET[mode].label}
            onClick={() => setMode(MODE_TOGGLE_TARGET[mode].key)}
          >
            {MODE_TOGGLE_TARGET[mode].icon}
          </button>
          <SearchToggle active={false} onClick={() => setSearchExpanded(true)} />
        </>
      )}
    </>
  );

  const editorOpen =
    !!selectedNoteId &&
    !!selectedNote &&
    (selectedNote.status === 'loaded' || selectedNote.status === 'saving');

  return (
    <div className="grafos-view">
      {topbarSlot && createPortal(topbarControls, topbarSlot)}
      {searchStatus && <p className="muted grafos-status-line grafos-view-floating-status">{searchStatus}</p>}

      {mode === 'graph' ? (
        <div className="grafos-view-body">
          <GrafosViewErrorBoundary fallbackTitle="O grafo encontrou um erro inesperado.">
            <Suspense fallback={<p className="muted">Carregando grafo…</p>}>
              <GrafosGraphView
                vault={vault}
                onEditNote={(fileId) => {
                  setSelectedNoteId(fileId);
                  void vault.openNote(fileId);
                }}
                onNodeDeleted={(fileId) => {
                  if (fileId === selectedNoteId) setSelectedNoteId(null);
                }}
              />
            </Suspense>
          </GrafosViewErrorBoundary>
        </div>
      ) : (
        <div className="grafos-view-body">
          <GrafosViewErrorBoundary fallbackTitle="O sistema solar encontrou um erro inesperado.">
            <Suspense fallback={<p className="muted">Carregando sistema solar…</p>}>
              <GrafosSolarSystemView
                vault={vault}
                onEditNote={(fileId) => {
                  setSelectedNoteId(fileId);
                  void vault.openNote(fileId);
                }}
                onNodeDeleted={(fileId) => {
                  if (fileId === selectedNoteId) setSelectedNoteId(null);
                }}
              />
            </Suspense>
          </GrafosViewErrorBoundary>
        </div>
      )}

      {selectedNoteId && (selectedNote?.status === 'loading' || selectedNote?.status === 'error' || editorOpen) && (
        <div className="grafos-note-editor-overlay" role="dialog" aria-label="Editor de nota">
          <button
            type="button"
            className="grafos-html-viewer-close-fab"
            onClick={() => setSelectedNoteId(null)}
            aria-label="Fechar nota"
          >
            ×
          </button>
          <div className="grafos-editor-pane">
            {selectedNote?.status === 'loading' && <p className="muted">Carregando…</p>}
            {selectedNote?.status === 'error' && <p className="error">{selectedNote.error}</p>}
            {editorOpen && selectedNote && (
              <>
                <div className="grafos-editor-toolbar">
                  <InlineEdit
                    value={stripMdExtension(selectedNoteName ?? '')}
                    onSave={(next) => void handleRename(next)}
                    className="grafos-note-title"
                    ariaLabel="renomear nota"
                  />
                  <span className="muted">
                    {selectedNote.status === 'saving' ? 'Salvando…' : selectedNote.dirty ? 'Alterações não salvas' : 'Salvo'}
                  </span>
                </div>
                {renameStatus && <p className="muted grafos-status-line">{renameStatus}</p>}
                <GrafosEditor
                  key={selectedNoteId}
                  value={selectedNote.content}
                  resetKey={`${selectedNoteId}:${selectedNote.loadedModifiedTime}`}
                  onChange={(value) => vault.editNote(selectedNoteId, value)}
                  onManualSave={() => void vault.saveNote(selectedNoteId)}
                  onSearchNotes={(query) => vault.searchNotes(query)}
                  onNavigateWikilink={(target) => void handleNavigateWikilink(target)}
                />
                {linkWarning && <p className="error grafos-status-line">{linkWarning}</p>}
                <section className="grafos-backlinks" aria-label="Notas que citam esta nota">
                  <h3>Backlinks</h3>
                  {backlinks.length === 0 ? (
                    <p className="muted">Nenhuma nota carregada nesta sessão cita esta.</p>
                  ) : (
                    <ul>
                      {backlinks.map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            className="grafos-backlink-item"
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
          </div>
        </div>
      )}

      {conflict.status === 'comparing' && (
        <GrafosConflictDialog
          conflict={conflict}
          onKeepMine={() => void vault.resolveKeepMine(conflict.fileId)}
          onUseRemote={() => vault.resolveUseRemote(conflict.fileId)}
          onKeepBoth={() => void vault.resolveKeepBoth(conflict.fileId)}
        />
      )}
    </div>
  );
}
