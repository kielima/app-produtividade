import { supabase } from '../lib/supabase';
import { subscribeTable, type Unsubscribe } from './realtimeTable';
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
  const { error } = await supabase.from('notes').upsert(noteToRow(uid, note));
  if (error) throw new Error(error.message);
}

export async function patchNote(uid: string, noteId: string, patch: Partial<Note>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.note !== undefined) row.note = patch.note;
  if (patch.items !== undefined) row.items = patch.items;
  if (patch.addedDate !== undefined) row.added_date = patch.addedDate;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.pinned !== undefined) row.pinned = patch.pinned;
  if (patch.projectId !== undefined) row.project_id = patch.projectId ?? null;
  if (patch.color !== undefined) row.color = patch.color ?? null;
  if (patch.sourceItemId !== undefined) row.source_item_id = patch.sourceItemId ?? null;
  if (patch.sourceAnnotationId !== undefined) row.source_annotation_id = patch.sourceAnnotationId ?? null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('notes').update(row).eq('user_id', uid).eq('id', noteId);
  if (error) throw new Error(error.message);
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
