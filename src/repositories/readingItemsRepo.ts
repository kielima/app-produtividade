import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { renameDriveFile } from '../lib/googleDrive';
import { retryWithBackoff } from '../lib/retry';
import type { DriveSyncPlan } from '../lib/driveSyncPlan';
import type { ReadingItem } from '../types';

// Itens da estante de leitura: users/{uid}/readingItems/{id}
function readingItemsCol(uid: string) {
  return collection(db, 'users', uid, 'readingItems');
}

function normalize(id: string, data: Partial<ReadingItem>): ReadingItem {
  return {
    id,
    driveFileId: data.driveFileId ?? '',
    format: data.format === 'epub' ? 'epub' : 'pdf',
    title: data.title ?? '',
    authors: Array.isArray(data.authors) ? data.authors : [],
    itemType: data.itemType ?? 'other',
    tags: Array.isArray(data.tags) ? data.tags : [],
    addedDate: data.addedDate ?? '',
    readingStatus: data.readingStatus ?? 'to-read',
    ...(data.fileName != null ? { fileName: data.fileName } : {}),
    ...(data.folderId != null ? { folderId: data.folderId } : {}),
    ...(data.folderPath != null ? { folderPath: data.folderPath } : {}),
    ...(data.doi != null ? { doi: data.doi } : {}),
    ...(data.isbn != null ? { isbn: data.isbn } : {}),
    ...(data.issn != null ? { issn: data.issn } : {}),
    ...(data.year != null ? { year: data.year } : {}),
    ...(data.publication != null ? { publication: data.publication } : {}),
    ...(data.lastOpenedAt != null ? { lastOpenedAt: data.lastOpenedAt } : {}),
    ...(data.autoClassifiedAt != null ? { autoClassifiedAt: data.autoClassifiedAt } : {}),
    ...(data.currentPage != null ? { currentPage: data.currentPage } : {}),
    ...(data.projectId != null ? { projectId: data.projectId } : {}),
  };
}

export function subscribeToReadingItems(
  uid: string,
  cb: (items: ReadingItem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    readingItemsCol(uid),
    (snap) => {
      const items = snap.docs.map((d) =>
        normalize(d.id, d.data() as Partial<ReadingItem>),
      );
      // Recentes primeiro: por última abertura, depois por data de adição.
      items.sort((a, b) => {
        const aKey = a.lastOpenedAt ?? a.addedDate;
        const bKey = b.lastOpenedAt ?? b.addedDate;
        return bKey.localeCompare(aKey) || a.title.localeCompare(b.title);
      });
      cb(items);
    },
    (err) => onError?.(err),
  );
}

// Todas as escritas abaixo usam retentativa com timeout (ver `lib/retry.ts`):
// no APK, o Firestore roda com cache em memória (a WebView não suporta
// IndexedDB) e uma escrita que nunca é confirmada pelo servidor (rede
// instável) fica pendurada para sempre e se perde em silêncio se o app for
// minimizado/fechado — sem isso, uma classificação/edição feita num aparelho
// pode nunca chegar aos outros.
export async function upsertReadingItem(
  uid: string,
  item: ReadingItem,
): Promise<void> {
  await retryWithBackoff(() =>
    setDoc(doc(db, 'users', uid, 'readingItems', item.id), item, { merge: true }),
  );
}

export async function patchReadingItem(
  uid: string,
  itemId: string,
  patch: Partial<ReadingItem>,
): Promise<void> {
  await retryWithBackoff(() =>
    setDoc(doc(db, 'users', uid, 'readingItems', itemId), patch, { merge: true }),
  );
}

export async function deleteReadingItem(
  uid: string,
  itemId: string,
): Promise<void> {
  await retryWithBackoff(() => deleteDoc(doc(db, 'users', uid, 'readingItems', itemId)));
}

// Salva o patch de metadados de um item. Quando o patch traz um fileName novo,
// renomeia PRIMEIRO no Google Drive; só persiste o nome no app se o Drive
// aceitar, mantendo app e Drive sempre coerentes (se o Drive falhar, nada muda
// e o erro sobe para a UI). O fileName vazio é ignorado — não renomeamos para "".
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

// Aplica um lote de planos (de `planDriveSyncItem`, em `lib/driveSyncPlan`)
// num único commit do Firestore — até 500 operações por lote, limite da API.
// Reduz milhares de idas-e-voltas individuais a poucas dezenas de commits.
export async function commitDriveSyncBatch(
  uid: string,
  entries: Array<{ id: string; plan: DriveSyncPlan }>,
): Promise<void> {
  const toWrite = entries.filter((e) => e.plan.kind !== 'skip');
  if (toWrite.length === 0) return;
  await retryWithBackoff(() => {
    const batch = writeBatch(db);
    for (const { id, plan } of toWrite) {
      const ref = doc(db, 'users', uid, 'readingItems', id);
      if (plan.kind === 'create') batch.set(ref, plan.item);
      else if (plan.kind === 'update') batch.set(ref, plan.patch, { merge: true });
    }
    return batch.commit();
  });
}

// Remove um lote de itens cujo arquivo correspondente não aparece mais na
// listagem atual do Drive (apagado, movido pra lixeira, ou perdeu acesso) —
// até 500 operações por lote, limite da API. Sem isso a estante só crescia:
// a sincronização criava/atualizava itens, mas nunca removia o que sumiu do
// Drive.
export async function deleteReadingItemsBatch(uid: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await retryWithBackoff(() => {
    const batch = writeBatch(db);
    for (const id of ids) {
      batch.delete(doc(db, 'users', uid, 'readingItems', id));
    }
    return batch.commit();
  });
}
