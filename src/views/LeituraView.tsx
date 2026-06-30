import { useEffect, useMemo, useState } from 'react';
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
} from '../lib/googleDrive';
import {
  LeituraFiltersBar,
  loadReadingFilters,
  saveReadingFilters,
  type ReadingFiltersState,
} from '../components/LeituraFiltersBar';
import { ReadingCard } from '../components/ReadingCard';
import { MetadataEditor } from '../components/MetadataEditor';
import { ReaderView } from './ReaderView';
import { useNoteNavigation } from '../lib/noteNavigation';
import { useTaskNavigation } from '../lib/taskNavigation';

type SyncState =
  | { status: 'idle' }
  | { status: 'syncing'; found: number }
  | { status: 'error'; message: string };

export function LeituraView({ uid, projects }: { uid: string; projects: Project[] }) {
  const noteNav = useNoteNavigation();
  const taskNav = useTaskNavigation();

  const [items, setItems] = useState<ReadingItem[]>([]);
  const [connected, setConnected] = useState(
    () => hasDriveAccess(uid) || hasEverConnectedDrive(),
  );
  const [sync, setSync] = useState<SyncState>({ status: 'idle' });
  const [filters, setFilters] = useState<ReadingFiltersState>(loadReadingFilters);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [metaItemId, setMetaItemId] = useState<string | null>(null);

  useEffect(() => subscribeToReadingItems(uid, setItems), [uid]);

  useEffect(() => saveReadingFilters(filters), [filters]);

  // Reaquece o token em background se o usuário já conectou antes.
  useEffect(() => {
    if (!hasDriveAccess(uid) && hasEverConnectedDrive()) {
      void tryRefreshDriveToken(uid).then((tok) => {
        if (tok) setConnected(true);
      });
    }
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
    setSync({ status: 'syncing', found: 0 });
    try {
      const token = await ensureDriveToken(uid);
      setConnected(true);
      const files = await listDrivePdfs(token);
      setSync({ status: 'syncing', found: files.length });
      for (const f of files) {
        await ensureReadingItemFromDrive(uid, { id: f.id, name: f.name });
      }
      setSync({ status: 'idle' });
    } catch (e) {
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
            {sync.status === 'syncing'
              ? `Sincronizando… (${sync.found})`
              : 'Sincronizar Drive'}
          </button>
        )}
        {sync.status === 'error' && <span className="error">{sync.message}</span>}
      </div>

      <LeituraFiltersBar
        state={filters}
        setState={setFilters}
        allAuthors={allAuthors}
        allTags={allTags}
      />

      {items.length === 0 ? (
        <div className="leitura-empty">
          <p>Sua estante está vazia.</p>
          <p className="muted">
            {connected
              ? 'Clique em "Sincronizar Drive" para importar seus PDFs.'
              : 'Conecte seu Google Drive para ver seus PDFs aqui.'}
          </p>
        </div>
      ) : (
        <div className="reading-shelf">
          {filtered.map((it) => (
            <ReadingCard
              key={it.id}
              item={it}
              onOpen={() => setOpenItemId(it.id)}
              onEditMetadata={() => setMetaItemId(it.id)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="muted leitura-no-match">Nenhum item corresponde aos filtros.</p>
          )}
        </div>
      )}

      {metaItem && (
        <MetadataEditor
          item={metaItem}
          onSave={(patch) => saveReadingMetadata(uid, metaItem, patch)}
          onClose={() => setMetaItemId(null)}
        />
      )}
    </div>
  );
}
