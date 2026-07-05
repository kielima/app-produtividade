import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { renameDriveFile } from '../lib/googleDrive';
import type { ReadingItem } from '../types';

// Itens da estante de leitura: users/{uid}/readingItems/{id}
function readingItemsCol(uid: string) {
  return collection(db, 'users', uid, 'readingItems');
}

function normalize(id: string, data: Partial<ReadingItem>): ReadingItem {
  return {
    id,
    driveFileId: data.driveFileId ?? '',
    format: 'pdf',
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

export async function upsertReadingItem(
  uid: string,
  item: ReadingItem,
): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'readingItems', item.id), item, {
    merge: true,
  });
}

export async function patchReadingItem(
  uid: string,
  itemId: string,
  patch: Partial<ReadingItem>,
): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'readingItems', itemId), patch, {
    merge: true,
  });
}

export async function deleteReadingItem(
  uid: string,
  itemId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'readingItems', itemId));
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

// Cria um item da estante a partir de um arquivo do Drive, SE ainda não
// existir. O id do doc é o próprio driveFileId, então re-sincronizar o Drive
// é idempotente: não duplica itens nem sobrescreve metadados/anotações que o
// usuário já editou. Retorna true quando criou um item novo.
export async function ensureReadingItemFromDrive(
  uid: string,
  file: { id: string; name: string; folderId?: string; folderPath?: string },
): Promise<boolean> {
  const ref = doc(db, 'users', uid, 'readingItems', file.id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    // Item já existe: o Drive é a fonte de verdade do nome do arquivo e da pasta,
    // então espelha o estado atual no app (cobre itens antigos sem fileName/pasta
    // e arquivos renomeados ou movidos direto no Drive). Não toca em mais nenhum
    // metadado editado.
    const data = existing.data() as Partial<ReadingItem>;
    const patch: Partial<ReadingItem> = {};
    if (data.fileName !== file.name) patch.fileName = file.name;
    if (file.folderId != null && data.folderId !== file.folderId) {
      patch.folderId = file.folderId;
    }
    if (file.folderPath != null && data.folderPath !== file.folderPath) {
      patch.folderPath = file.folderPath;
    }
    if (Object.keys(patch).length > 0) {
      await setDoc(ref, patch, { merge: true });
    }
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  const item: ReadingItem = {
    id: file.id,
    driveFileId: file.id,
    fileName: file.name,
    ...(file.folderId != null ? { folderId: file.folderId } : {}),
    ...(file.folderPath != null ? { folderPath: file.folderPath } : {}),
    format: 'pdf',
    title: file.name.replace(/\.pdf$/i, ''),
    authors: [],
    itemType: 'other',
    tags: [],
    addedDate: today,
    readingStatus: 'to-read',
  };
  await setDoc(ref, item);
  return true;
}
