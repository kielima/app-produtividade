import { supabase } from '../lib/supabase';
import { publishLocalRow, subscribeTable, type Unsubscribe } from './realtimeTable';
import type { NoteComment } from '../types';

interface NoteCommentRow {
  id: string;
  user_id: string;
  note_id: string;
  texto: string;
  autor_nome: string | null;
  autor_email: string | null;
  criado_em: string;
}

function rowToComment(row: NoteCommentRow): NoteComment {
  return {
    id: row.id,
    noteId: row.note_id,
    texto: row.texto,
    autorNome: row.autor_nome,
    autorEmail: row.autor_email,
    criadoEm: row.criado_em,
  };
}

/** Comentários de UMA nota, em ordem de criação. */
export function subscribeToNoteComments(
  uid: string,
  noteId: string,
  cb: (comments: NoteComment[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<NoteCommentRow, NoteComment>(
    {
      table: 'note_comments',
      uid,
      extraColumn: 'note_id',
      extraValue: noteId,
      mapRow: rowToComment,
      idOf: (c) => c.id,
      onError,
    },
    (list) => cb([...list].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))),
  );
}

export async function addNoteComment(
  uid: string,
  noteId: string,
  texto: string,
  autor: { nome: string | null; email: string | null },
): Promise<void> {
  const corpo = texto.trim();
  if (!corpo) throw new Error('O comentário não pode ficar vazio.');
  const { data, error } = await supabase
    .from('note_comments')
    .insert({
      user_id: uid,
      note_id: noteId,
      texto: corpo.slice(0, 4000),
      autor_nome: autor.nome,
      autor_email: autor.email,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  publishLocalRow('note_comments', noteId, data);
}

export async function deleteNoteComment(uid: string, id: string): Promise<void> {
  const { error } = await supabase.from('note_comments').delete().eq('user_id', uid).eq('id', id);
  if (error) throw new Error(error.message);
}
