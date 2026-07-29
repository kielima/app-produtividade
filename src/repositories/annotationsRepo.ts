import { supabase } from '../lib/supabase';
import { subscribeTable, type Unsubscribe } from './realtimeTable';
import type { Annotation } from '../types';

interface AnnotationRow {
  id: string;
  user_id: string;
  reading_item_id: string;
  page: number;
  type: string | null;
  color: string | null;
  rects: unknown;
  text: string | null;
  title: string | null;
  comment: string | null;
  strokes: unknown;
  anchor: unknown;
  cfi: string | null;
  created_at: string | null;
  linked_task_id: string | null;
  linked_note_id: string | null;
}

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    itemId: row.reading_item_id,
    page: typeof row.page === 'number' ? row.page : 1,
    type: (row.type as Annotation['type']) ?? 'highlight',
    color: row.color ?? '#ffd54a',
    createdAt: row.created_at ?? '',
    ...(Array.isArray(row.rects) ? { rects: row.rects as Annotation['rects'] } : {}),
    ...(row.text != null ? { text: row.text } : {}),
    ...(row.title != null ? { title: row.title } : {}),
    ...(row.comment != null ? { comment: row.comment } : {}),
    ...(Array.isArray(row.strokes) ? { strokes: row.strokes as Annotation['strokes'] } : {}),
    ...(row.anchor != null ? { anchor: row.anchor as Annotation['anchor'] } : {}),
    ...(row.cfi != null ? { cfi: row.cfi } : {}),
    ...(row.linked_task_id != null ? { linkedTaskId: row.linked_task_id } : {}),
    ...(row.linked_note_id != null ? { linkedNoteId: row.linked_note_id } : {}),
  };
}

function annotationToRow(uid: string, annotation: Annotation): AnnotationRow {
  return {
    id: annotation.id,
    user_id: uid,
    reading_item_id: annotation.itemId,
    page: annotation.page,
    type: annotation.type,
    color: annotation.color,
    rects: annotation.rects ?? null,
    text: annotation.text ?? null,
    title: annotation.title ?? null,
    comment: annotation.comment ?? null,
    strokes: annotation.strokes ?? null,
    anchor: annotation.anchor ?? null,
    cfi: annotation.cfi ?? null,
    created_at: annotation.createdAt,
    linked_task_id: annotation.linkedTaskId ?? null,
    linked_note_id: annotation.linkedNoteId ?? null,
  };
}

function topOf(a: Annotation): number {
  if (a.rects && a.rects.length > 0) return a.rects[0].y;
  if (a.anchor) return a.anchor.y;
  if (a.strokes && a.strokes.length > 0 && a.strokes[0].points.length > 0) {
    return a.strokes[0].points[0].y;
  }
  return 0;
}

export function subscribeToAnnotations(
  uid: string,
  itemId: string,
  cb: (annotations: Annotation[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<AnnotationRow, Annotation>(
    {
      table: 'annotations',
      uid,
      extraColumn: 'reading_item_id',
      extraValue: itemId,
      mapRow: rowToAnnotation,
      idOf: (a) => a.id,
      onError,
    },
    (list) => {
      list.sort((a, b) => (a.page !== b.page ? a.page - b.page : topOf(a) - topOf(b)));
      cb(list);
    },
  );
}

export async function upsertAnnotation(uid: string, annotation: Annotation): Promise<void> {
  const { error } = await supabase.from('annotations').upsert(annotationToRow(uid, annotation));
  if (error) throw new Error(error.message);
}

// Atualiza campos pontuais de uma anotação sem precisar do objeto inteiro
// (ex.: linkedTaskId/linkedNoteId ao vincular/revincular a partir de fora do
// leitor, como na conversão nota → tarefa). Passe `null` explicitamente para
// limpar um campo.
export async function patchAnnotation(
  uid: string,
  itemId: string,
  annotationId: string,
  patch: { [K in keyof Annotation]?: Annotation[K] | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if ('page' in patch) row.page = patch.page;
  if ('type' in patch) row.type = patch.type;
  if ('color' in patch) row.color = patch.color;
  if ('rects' in patch) row.rects = patch.rects ?? null;
  if ('text' in patch) row.text = patch.text ?? null;
  if ('title' in patch) row.title = patch.title ?? null;
  if ('comment' in patch) row.comment = patch.comment ?? null;
  if ('strokes' in patch) row.strokes = patch.strokes ?? null;
  if ('anchor' in patch) row.anchor = patch.anchor ?? null;
  if ('cfi' in patch) row.cfi = patch.cfi ?? null;
  if ('createdAt' in patch) row.created_at = patch.createdAt;
  if ('linkedTaskId' in patch) row.linked_task_id = patch.linkedTaskId ?? null;
  if ('linkedNoteId' in patch) row.linked_note_id = patch.linkedNoteId ?? null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('annotations')
    .update(row)
    .eq('user_id', uid)
    .eq('reading_item_id', itemId)
    .eq('id', annotationId);
  if (error) throw new Error(error.message);
}

export async function deleteAnnotation(uid: string, itemId: string, annotationId: string): Promise<void> {
  const { error } = await supabase
    .from('annotations')
    .delete()
    .eq('user_id', uid)
    .eq('reading_item_id', itemId)
    .eq('id', annotationId);
  if (error) throw new Error(error.message);
}

// Gera um id novo para uma anotação (sem persistir ainda). uid/itemId não são
// usados na geração em si (mantidos só para não obrigar os chamadores a
// mudar a assinatura).
export function newAnnotationId(_uid: string, _itemId: string): string {
  return crypto.randomUUID();
}
