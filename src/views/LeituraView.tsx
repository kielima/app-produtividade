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
  resolveDriveFolderPath,
  type DriveFolderMeta,
} from '../lib/googleDrive';
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
  | { status: 'syncing'; found: number }
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
}: {
  uid: string;
  projects: Project[];
  filters: ReadingFiltersState;
  onOptionsChange: (opts: {
    authors: string[];
    tags: string[];
    types: string[];
  }) => void;
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

  useEffect(() => subscribeToReadingItems(uid, setItems), [uid]);

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
      // Cache de pastas compartilhado por toda a sincronização: muitas PDFs
      // dividem as mesmas pastas, então cada uma só é resolvida uma vez.
      const folderCache = new Map<string, DriveFolderMeta | null>();
      for (const f of files) {
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
