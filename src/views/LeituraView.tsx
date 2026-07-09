import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ReadingItem } from '../types';
import {
  ensureReadingItemFromDrive,
  saveReadingMetadata,
  subscribeToReadingItems,
} from '../repositories/readingItemsRepo';
import {
  grantDriveAccess,
  hasDriveAccess,
  hasEverConnectedDrive,
  listDrivePdfs,
  ensureDriveToken,
  tryRefreshDriveToken,
  resolveDriveFolderPath,
  type DriveFolderMeta,
} from '../lib/googleDrive';
import {
  loadSyncCheckpoint,
  saveSyncCheckpoint,
  clearSyncCheckpoint,
} from '../lib/driveSyncCheckpoint';
import { type ReadingFiltersState } from '../components/LeituraFiltersBar';
import { ReadingCard } from '../components/ReadingCard';
import {
  ReadingTable,
  loadReadingColumns,
  saveReadingColumns,
  type ReadingColumnConfig,
} from '../components/ReadingTable';
import { MetadataEditor } from '../components/MetadataEditor';
import { groupIntoShelves, sortReadingTypes } from '../lib/readingTypes';
import { ReaderView } from './ReaderView';
import { useNoteNavigation } from '../lib/noteNavigation';
import { useTaskNavigation } from '../lib/taskNavigation';

type SyncState =
  | { status: 'idle' }
  | { status: 'syncing'; found: number; processed: number }
  | { status: 'error'; message: string };

type LeituraLayout = 'shelf' | 'table';

const LEITURA_LAYOUT_KEY = 'app-produtividade:reading-layout';

function loadLeituraLayout(): LeituraLayout {
  return localStorage.getItem(LEITURA_LAYOUT_KEY) === 'table' ? 'table' : 'shelf';
}

export function LeituraView({
  uid,
  projects,
  filters,
  onOptionsChange,
  pendingTarget,
  onPendingTargetHandled,
}: {
  uid: string;
  projects: Project[];
  filters: ReadingFiltersState;
  onOptionsChange: (opts: {
    authors: string[];
    tags: string[];
    types: string[];
  }) => void;
  // Vínculo tarefa/nota → PDF: item + anotação para abrir direto ao entrar
  // nesta aba (ver `useReadingNavigation`).
  pendingTarget?: { itemId: string; annotationId: string } | null;
  onPendingTargetHandled?: () => void;
}) {
  const noteNav = useNoteNavigation();
  const taskNav = useTaskNavigation();

  const [items, setItems] = useState<ReadingItem[]>([]);
  const [connected, setConnected] = useState(
    () => hasDriveAccess(uid) || hasEverConnectedDrive(),
  );
  const [sync, setSync] = useState<SyncState>({ status: 'idle' });
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [metaItemId, setMetaItemId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LeituraLayout>(loadLeituraLayout);
  const [columns, setColumns] = useState<ReadingColumnConfig[]>(loadReadingColumns);
  const [focusAnnotationId, setFocusAnnotationId] = useState<string | null>(null);

  useEffect(() => subscribeToReadingItems(uid, setItems), [uid]);

  useEffect(() => {
    if (!pendingTarget) return;
    setOpenItemId(pendingTarget.itemId);
    setFocusAnnotationId(pendingTarget.annotationId);
    onPendingTargetHandled?.();
  }, [pendingTarget, onPendingTargetHandled]);

  useEffect(() => {
    localStorage.setItem(LEITURA_LAYOUT_KEY, layout);
  }, [layout]);

  useEffect(() => saveReadingColumns(columns), [columns]);

  // Reaquece o token em background se o usuário já conectou antes.
  useEffect(() => {
    if (!hasDriveAccess(uid) && hasEverConnectedDrive()) {
      void tryRefreshDriveToken(uid).then((tok) => {
        if (tok) setConnected(true);
      });
    }
  }, [uid]);

  // IDs já sincronizados na sincronização em curso. Fica em ref (não state)
  // porque é atualizado por arquivo e só precisa ser lido, não re-renderizar.
  const syncDoneIdsRef = useRef<Set<string> | null>(null);

  // Ao minimizar o app no meio de uma sincronização grande, o SO pode
  // suspender/matar o WebView e perder todo o progresso em memória. Salva um
  // checkpoint assim que a aba/app sai de foco, pra retomar dali depois.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden' && syncDoneIdsRef.current) {
        saveSyncCheckpoint(uid, syncDoneIdsRef.current);
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [uid]);

  async function connect() {
    try {
      await grantDriveAccess(uid);
      setConnected(true);
      void syncDrive();
    } catch (e) {
      setSync({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function syncDrive() {
    setSync({ status: 'syncing', found: 0, processed: 0 });
    try {
      let token = await ensureDriveToken(uid);
      setConnected(true);
      const files = await listDrivePdfs(token);
      const currentIds = new Set(files.map((f) => f.id));
      // Retoma de onde parou se a sincronização anterior foi interrompida
      // (app minimizado/fechado pelo SO no meio do processo) em vez de
      // reprocessar milhares de arquivos que já tinham sido sincronizados.
      const doneIds = new Set(
        [...loadSyncCheckpoint(uid)].filter((id) => currentIds.has(id)),
      );
      syncDoneIdsRef.current = doneIds;
      const pending = files.filter((f) => !doneIds.has(f.id));
      setSync({ status: 'syncing', found: files.length, processed: doneIds.size });
      // Cache de pastas compartilhado por toda a sincronização: muitas PDFs
      // dividem as mesmas pastas, então cada uma só é resolvida uma vez.
      const folderCache = new Map<string, DriveFolderMeta | null>();
      for (const f of pending) {
        // Sincronizações grandes podem passar da validade do token (ou o app
        // pode ter voltado de segundo plano com ele expirado); ensureDriveToken
        // usa o cache e só renova quando necessário. Fora do try/catch abaixo
        // de propósito: se o token não puder ser renovado (ex.: precisa de
        // consentimento interativo, impossível em segundo plano), é melhor
        // parar a sincronização do que tentar de novo em cada arquivo restante.
        token = await ensureDriveToken(uid);
        try {
          let folderId: string | undefined;
          let folderPath: string | undefined;
          const parent = f.parents?.[0];
          if (parent) {
            const resolved = await resolveDriveFolderPath(token, parent, folderCache);
            folderId = resolved.folderId;
            folderPath = resolved.folderPath;
          }
          await ensureReadingItemFromDrive(uid, {
            id: f.id,
            name: f.name,
            folderId,
            folderPath,
          });
          doneIds.add(f.id);
        } catch (err) {
          // Um arquivo com problema não deve abortar os outros milhares;
          // como ele não entra em doneIds, a próxima sincronização tenta de novo.
          console.warn('[leitura] falha ao sincronizar arquivo do Drive:', f.id, err);
        }
        if (doneIds.size % 50 === 0) saveSyncCheckpoint(uid, doneIds);
        setSync({ status: 'syncing', found: files.length, processed: doneIds.size });
      }
      if (doneIds.size >= files.length) {
        clearSyncCheckpoint(uid);
      } else {
        saveSyncCheckpoint(uid, doneIds);
      }
      syncDoneIdsRef.current = null;
      setSync({ status: 'idle' });
    } catch (e) {
      if (syncDoneIdsRef.current) saveSyncCheckpoint(uid, syncDoneIdsRef.current);
      syncDoneIdsRef.current = null;
      setSync({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const allAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const a of it.authors) set.add(a);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const t of it.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const allTypes = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(it.itemType || 'other');
    return sortReadingTypes([...set]);
  }, [items]);

  // Publica as opções de filtro para a barra que vive no topbar (App).
  useEffect(() => {
    onOptionsChange({ authors: allAuthors, tags: allTags, types: allTypes });
  }, [allAuthors, allTags, allTypes, onOptionsChange]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter((it) => {
      if (filters.author && !it.authors.includes(filters.author)) return false;
      if (filters.tag && !it.tags.includes(filters.tag)) return false;
      if (filters.itemType !== 'all' && it.itemType !== filters.itemType) return false;
      if (filters.status !== 'all' && it.readingStatus !== filters.status) return false;
      if (q) {
        const hay = [
          it.title,
          it.authors.join(' '),
          it.publication ?? '',
          it.doi ?? '',
          it.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filters]);

  const shelves = useMemo(() => groupIntoShelves(filtered), [filtered]);

  const syncProgressPct =
    sync.status === 'syncing' && sync.found > 0
      ? Math.round((sync.processed / sync.found) * 100)
      : 0;

  const openItem = openItemId ? items.find((i) => i.id === openItemId) ?? null : null;
  const metaItem = metaItemId ? items.find((i) => i.id === metaItemId) ?? null : null;

  if (openItem) {
    return (
      <ReaderView
        uid={uid}
        item={openItem}
        projects={projects}
        onClose={() => setOpenItemId(null)}
        onConverted={(dest, id) => {
          setOpenItemId(null);
          if (dest === 'note') noteNav.openNote(id);
          else taskNav.openTask(id);
        }}
        focusAnnotationId={focusAnnotationId}
        onFocusHandled={() => setFocusAnnotationId(null)}
      />
    );
  }

  return (
    <div className="leitura-view">
      <div className="leitura-toolbar">
        {!connected ? (
          <button type="button" className="leitura-connect" onClick={connect}>
            Conectar Google Drive
          </button>
        ) : (
          <button
            type="button"
            className="leitura-sync"
            onClick={() => void syncDrive()}
            disabled={sync.status === 'syncing'}
          >
            {sync.status === 'syncing' ? 'Sincronizando…' : 'Sincronizar Drive'}
          </button>
        )}
        {sync.status === 'error' && <span className="error">{sync.message}</span>}

        {sync.status === 'syncing' && (
          <div
            className="classify-progress leitura-sync-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={syncProgressPct}
            aria-label="progresso da sincronização"
          >
            <div className="classify-progress-track">
              <div
                className="classify-progress-fill"
                style={{ width: `${syncProgressPct}%` }}
              />
            </div>
            <span className="classify-progress-label">
              {sync.processed} de {sync.found} arquivo{sync.found === 1 ? '' : 's'} ·{' '}
              {syncProgressPct}%
            </span>
          </div>
        )}

        <div className="leitura-layout-toggle" role="group" aria-label="Modo de visualização">
          <button
            type="button"
            className={layout === 'shelf' ? 'active' : ''}
            aria-pressed={layout === 'shelf'}
            onClick={() => setLayout('shelf')}
          >
            Estante
          </button>
          <button
            type="button"
            className={layout === 'table' ? 'active' : ''}
            aria-pressed={layout === 'table'}
            onClick={() => setLayout('table')}
          >
            Tabela
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="leitura-empty">
          <p>Sua estante está vazia.</p>
          <p className="muted">
            {connected
              ? 'Clique em "Sincronizar Drive" para importar seus PDFs.'
              : 'Conecte seu Google Drive para ver seus PDFs aqui.'}
          </p>
        </div>
      ) : layout === 'table' ? (
        <ReadingTable
          items={filtered}
          columns={columns}
          setColumns={setColumns}
          onOpen={(it) => setOpenItemId(it.id)}
          onEditMetadata={(it) => setMetaItemId(it.id)}
        />
      ) : filtered.length === 0 ? (
        <p className="muted leitura-no-match">Nenhum item corresponde aos filtros.</p>
      ) : (
        <div className="reading-shelves">
          {shelves.map((shelf) => (
            <section key={shelf.type} className="reading-shelf-row">
              <header className="reading-shelf-header">
                <h2 className="reading-shelf-title">{shelf.label}</h2>
                <span className="reading-shelf-count">{shelf.items.length}</span>
              </header>
              <div className="reading-shelf-carousel">
                {shelf.items.map((it) => (
                  <ReadingCard
                    key={it.id}
                    item={it}
                    onOpen={() => setOpenItemId(it.id)}
                    onEditMetadata={() => setMetaItemId(it.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {metaItem && (
        <MetadataEditor
          item={metaItem}
          allTypes={allTypes}
          onSave={(patch) => saveReadingMetadata(uid, metaItem, patch)}
          onClose={() => setMetaItemId(null)}
        />
      )}
    </div>
  );
}
