import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Annotation } from '../types';

// Anotações de um item: users/{uid}/readingItems/{itemId}/annotations/{id}
function annotationsCol(uid: string, itemId: string) {
  return collection(db, 'users', uid, 'readingItems', itemId, 'annotations');
}

function normalize(id: string, itemId: string, data: Partial<Annotation>): Annotation {
  return {
    id,
    itemId,
    page: typeof data.page === 'number' ? data.page : 1,
    type: data.type ?? 'highlight',
    color: data.color ?? '#ffd54a',
    createdAt: data.createdAt ?? '',
    ...(Array.isArray(data.rects) ? { rects: data.rects } : {}),
    ...(data.text != null ? { text: data.text } : {}),
    ...(data.title != null ? { title: data.title } : {}),
    ...(data.comment != null ? { comment: data.comment } : {}),
    ...(Array.isArray(data.strokes) ? { strokes: data.strokes } : {}),
    ...(data.anchor != null ? { anchor: data.anchor } : {}),
  };
}

export function subscribeToAnnotations(
  uid: string,
  itemId: string,
  cb: (annotations: Annotation[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    annotationsCol(uid, itemId),
    (snap) => {
      const list = snap.docs.map((d) =>
        normalize(d.id, itemId, d.data() as Partial<Annotation>),
      );
      // Ordena por página e, dentro da página, por posição vertical (topo do
      // primeiro rect/anchor) — facilita listar no painel lateral em ordem de
      // leitura.
      list.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        return topOf(a) - topOf(b);
      });
      cb(list);
    },
    (err) => onError?.(err),
  );
}

function topOf(a: Annotation): number {
  if (a.rects && a.rects.length > 0) return a.rects[0].y;
  if (a.anchor) return a.anchor.y;
  if (a.strokes && a.strokes.length > 0 && a.strokes[0].points.length > 0) {
    return a.strokes[0].points[0].y;
  }
  return 0;
}

export async function upsertAnnotation(
  uid: string,
  annotation: Annotation,
): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'readingItems', annotation.itemId, 'annotations', annotation.id),
    annotation,
    { merge: true },
  );
}

export async function deleteAnnotation(
  uid: string,
  itemId: string,
  annotationId: string,
): Promise<void> {
  await deleteDoc(
    doc(db, 'users', uid, 'readingItems', itemId, 'annotations', annotationId),
  );
}

// Gera um id de doc novo para uma anotação (sem persistir ainda).
export function newAnnotationId(uid: string, itemId: string): string {
  return doc(annotationsCol(uid, itemId)).id;
}
