import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Note } from '../types';

function notesCol(uid: string) {
  return collection(db, 'users', uid, 'notes');
}

export function subscribeToNotes(
  uid: string,
  cb: (notes: Note[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    notesCol(uid),
    (snap) => {
      const notes: Note[] = snap.docs.map((d) => {
        const data = d.data() as Partial<Note>;
        return {
          id: d.id,
          title: data.title ?? '',
          note: data.note ?? '',
          items: data.items ?? [],
          addedDate: data.addedDate ?? '',
          tags: Array.isArray(data.tags) ? data.tags : [],
          pinned: data.pinned === true,
        };
      });
      notes.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.addedDate.localeCompare(a.addedDate) || b.id.localeCompare(a.id);
      });
      cb(notes);
    },
    (err) => onError?.(err),
  );
}

export async function upsertNote(uid: string, note: Note): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'notes', note.id), note, { merge: true });
}

export async function patchNote(uid: string, noteId: string, patch: Partial<Note>): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'notes', noteId), patch, { merge: true });
}

export async function deleteNote(uid: string, noteId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'notes', noteId));
}

export async function createNote(uid: string): Promise<Note> {
  const id = doc(notesCol(uid)).id;
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
