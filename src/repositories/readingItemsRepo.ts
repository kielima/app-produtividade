import { supabase } from '../lib/supabase';
import { renameDriveFile } from '../lib/googleDrive';
import { retryWithBackoff } from '../lib/retry';
import type { DriveSyncPlan } from '../lib/driveSyncPlan';
import { subscribeTable, type Unsubscribe } from './realtimeTable';
import type { ReadingItem } from '../types';

interface ReadingItemRow {
  id: string;
  user_id: string;
  drive_file_id: string | null;
  file_name: string | null;
  folder_id: string | null;
  folder_path: string | null;
  format: string | null;
  title: string | null;
  authors: string[] | null;
  item_type: string | null;
  doi: string | null;
  isbn: string | null;
  issn: string | null;
  year: string | null;
  publication: string | null;
  tags: string[] | null;
  added_date: string | null;
  last_opened_at: string | null;
  auto_classified_at: string | null;
  reading_status: string | null;
  current_page: number | null;
  project_id: string | null;
}

function rowToItem(row: ReadingItemRow): ReadingItem {
  return {
    id: row.id,
    driveFileId: row.drive_file_id ?? '',
    format: row.format === 'epub' ? 'epub' : 'pdf',
    title: row.title ?? '',
    authors: Array.isArray(row.authors) ? row.authors : [],
    itemType: row.item_type ?? 'other',
    tags: Array.isArray(row.tags) ? row.tags : [],
    addedDate: row.added_date ?? '',
    readingStatus: (row.reading_status as ReadingItem['readingStatus']) ?? 'to-read',
    ...(row.file_name != null ? { fileName: row.file_name } : {}),
    ...(row.folder_id != null ? { folderId: row.folder_id } : {}),
    ...(row.folder_path != null ? { folderPath: row.folder_path } : {}),
    ...(row.doi != null ? { doi: row.doi } : {}),
    ...(row.isbn != null ? { isbn: row.isbn } : {}),
    ...(row.issn != null ? { issn: row.issn } : {}),
    ...(row.year != null ? { year: row.year } : {}),
    ...(row.publication != null ? { publication: row.publication } : {}),
    ...(row.last_opened_at != null ? { lastOpenedAt: row.last_opened_at } : {}),
    ...(row.auto_classified_at != null ? { autoClassifiedAt: row.auto_classified_at } : {}),
    ...(row.current_page != null ? { currentPage: row.current_page } : {}),
    ...(row.project_id != null ? { projectId: row.project_id } : {}),
  };
}

function itemToRow(uid: string, item: Partial<ReadingItem> & { id: string }): Record<string, unknown> {
  const row: Record<string, unknown> = { id: item.id, user_id: uid };
  if (item.driveFileId !== undefined) row.drive_file_id = item.driveFileId;
  if (item.fileName !== undefined) row.file_name = item.fileName ?? null;
  if (item.folderId !== undefined) row.folder_id = item.folderId ?? null;
  if (item.folderPath !== undefined) row.folder_path = item.folderPath ?? null;
  if (item.format !== undefined) row.format = item.format;
  if (item.title !== undefined) row.title = item.title;
  if (item.authors !== undefined) row.authors = item.authors;
  if (item.itemType !== undefined) row.item_type = item.itemType;
  if (item.doi !== undefined) row.doi = item.doi ?? null;
  if (item.isbn !== undefined) row.isbn = item.isbn ?? null;
  if (item.issn !== undefined) row.issn = item.issn ?? null;
  if (item.year !== undefined) row.year = item.year ?? null;
  if (item.publication !== undefined) row.publication = item.publication ?? null;
  if (item.tags !== undefined) row.tags = item.tags;
  if (item.addedDate !== undefined) row.added_date = item.addedDate;
  if (item.lastOpenedAt !== undefined) row.last_opened_at = item.lastOpenedAt ?? null;
  if (item.autoClassifiedAt !== undefined) row.auto_classified_at = item.autoClassifiedAt ?? null;
  if (item.readingStatus !== undefined) row.reading_status = item.readingStatus;
  if (item.currentPage !== undefined) row.current_page = item.currentPage ?? null;
  if (item.projectId !== undefined) row.project_id = item.projectId ?? null;
  return row;
}

export function subscribeToReadingItems(
  uid: string,
  cb: (items: ReadingItem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<ReadingItemRow, ReadingItem>(
    { table: 'reading_items', uid, mapRow: rowToItem, idOf: (i) => i.id, onError },
    (items) => {
      items.sort((a, b) => {
        const aKey = a.lastOpenedAt ?? a.addedDate;
        const bKey = b.lastOpenedAt ?? b.addedDate;
        return bKey.localeCompare(aKey) || a.title.localeCompare(b.title);
      });
      cb(items);
    },
  );
}

// Todas as escritas abaixo usam retentativa com timeout (ver `lib/retry.ts`):
// preserva o mesmo comportamento defensivo contra rede instável que o app já
// tinha com o Firestore.
export async function upsertReadingItem(uid: string, item: ReadingItem): Promise<void> {
  await retryWithBackoff(async () => {
    const { error } = await supabase.from('reading_items').upsert(itemToRow(uid, item));
    if (error) throw new Error(error.message);
  });
}

export async function patchReadingItem(
  uid: string,
  itemId: string,
  patch: Partial<ReadingItem>,
): Promise<void> {
  await retryWithBackoff(async () => {
    const row = itemToRow(uid, { ...patch, id: itemId });
    delete row.id;
    delete row.user_id;
    const { error } = await supabase.from('reading_items').update(row).eq('user_id', uid).eq('id', itemId);
    if (error) throw new Error(error.message);
  });
}

export async function deleteReadingItem(uid: string, itemId: string): Promise<void> {
  await retryWithBackoff(async () => {
    const { error } = await supabase.from('reading_items').delete().eq('user_id', uid).eq('id', itemId);
    if (error) throw new Error(error.message);
  });
}

// Salva o patch de metadados de um item. Quando o patch traz um fileName novo,
// renomeia PRIMEIRO no Google Drive; só persiste o nome no app se o Drive
// aceitar, mantendo app e Drive sempre coerentes.
export async function saveReadingMetadata(
  uid: string,
  item: ReadingItem,
  patch: Partial<ReadingItem>,
): Promise<void> {
  const next: Partial<ReadingItem> = { ...patch };
  const newName = next.fileName?.trim();
  if (newName) {
    const saved = await renameDriveFile(uid, item.driveFileId, newName);
    next.fileName = saved;
  } else {
    delete next.fileName;
  }
  await patchReadingItem(uid, item.id, next);
}

// Aplica um lote de planos (de `planDriveSyncItem`, em `lib/driveSyncPlan`).
// Itens 'create' vão num único upsert; itens 'update' são aplicados em
// paralelo (patches parciais) — não é uma transação única como o batch do
// Firestore, mas é aceitável para uma sincronização de background.
export async function commitDriveSyncBatch(
  uid: string,
  entries: Array<{ id: string; plan: DriveSyncPlan }>,
): Promise<void> {
  const creates = entries.filter((e) => e.plan.kind === 'create');
  const updates = entries.filter((e) => e.plan.kind === 'update');
  if (creates.length === 0 && updates.length === 0) return;

  await retryWithBackoff(async () => {
    if (creates.length > 0) {
      const rows = creates.map((e) =>
        itemToRow(uid, { ...(e.plan.kind === 'create' ? e.plan.item : {}), id: e.id }),
      );
      const { error } = await supabase.from('reading_items').upsert(rows);
      if (error) throw new Error(error.message);
    }
    if (updates.length > 0) {
      await Promise.all(
        updates.map((e) => {
          const row = itemToRow(uid, { ...(e.plan.kind === 'update' ? e.plan.patch : {}), id: e.id });
          delete row.id;
          delete row.user_id;
          return supabase.from('reading_items').update(row).eq('user_id', uid).eq('id', e.id);
        }),
      );
    }
  });
}

// Remove um lote de itens cujo arquivo correspondente não aparece mais na
// listagem atual do Drive.
export async function deleteReadingItemsBatch(uid: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await retryWithBackoff(async () => {
    const { error } = await supabase.from('reading_items').delete().eq('user_id', uid).in('id', ids);
    if (error) throw new Error(error.message);
  });
}
