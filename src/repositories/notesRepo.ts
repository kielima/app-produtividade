import { supabase } from '../lib/supabase';
import { publishLocalRow, subscribeTable, type Unsubscribe } from './realtimeTable';
import type { Note } from '../types';

interface NoteRow {
  id: string;
  user_id: string;
  title: string | null;
  note: string | null;
  items: unknown;
  added_date: string | null;
  tags: string[] | null;
  pinned: boolean;
  project_id: string | null;
  color: string | null;
  source_item_id: string | null;
  source_annotation_id: string | null;
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title ?? '',
    note: row.note ?? '',
    items: (row.items as Note['items']) ?? [],
    addedDate: row.added_date ?? '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    pinned: row.pinned === true,
    ...(row.project_id != null ? { projectId: row.project_id } : {}),
    ...(row.color != null ? { color: row.color } : {}),
    ...(row.source_item_id != null ? { sourceItemId: row.source_item_id } : {}),
    ...(row.source_annotation_id != null ? { sourceAnnotationId: row.source_annotation_id } : {}),
  };
}

export function noteToRow(uid: string, note: Note): NoteRow {
  return {
    id: note.id,
    user_id: uid,
    title: note.title,
    note: note.note,
    items: note.items,
    added_date: note.addedDate,
    tags: note.tags,
    pinned: note.pinned,
    project_id: note.projectId ?? null,
    color: note.color ?? null,
    source_item_id: note.sourceItemId ?? null,
    source_annotation_id: note.sourceAnnotationId ?? null,
  };
}

export function subscribeToNotes(
  uid: string,
  cb: (notes: Note[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<NoteRow, Note>(
    { table: 'notes', uid, mapRow: rowToNote, idOf: (n) => n.id, onError },
    (notes) => {
      notes.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.addedDate.localeCompare(a.addedDate) || b.id.localeCompare(a.id);
      });
      cb(notes);
    },
  );
}

export async function upsertNote(uid: string, note: Note): Promise<void> {
  const row = noteToRow(uid, note);
  const { error } = await supabase.from('notes').upsert(row);
  if (error) throw new Error(error.message);
  // A anotação passa a existir no estado local assim que a gravação confirma,
  // sem esperar o INSERT do Realtime — é isto que permite criar uma anotação
  // e abrir a tela dela em seguida (ver `publishLocalRow`).
  publishLocalRow('notes', uid, row);
}

// Mescla `patch` na anotação atual e grava a linha inteira via `upsertNote`
// (em vez de um `.update()` parcial), pelo mesmo motivo de `patchTask` em
// `taskMutations.ts`: só `upsertNote` ecoa a linha no estado local
// (`publishLocalRow`). Um `.update()` parcial deixava quem editava título/nota
// e saía da tela dependendo só do Realtime pra ver a mudança refletida —
// lento ou, se o evento se perdesse, nunca.
export async function patchNote(uid: string, note: Note, patch: Partial<Note>): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await upsertNote(uid, { ...note, ...patch });
}

export async function deleteNote(uid: string, noteId: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('user_id', uid).eq('id', noteId);
  if (error) throw new Error(error.message);
}

export async function createNote(uid: string): Promise<Note> {
  const id = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const note: Note = {
    id,
    title: '',
    note: '',
    items: [],
    addedDate: today,
    tags: [],
    pinned: false,
  };
  await upsertNote(uid, note);
  return note;
}
