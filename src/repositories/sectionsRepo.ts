import { collection, doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Section } from '../types';

function sectionsCol(uid: string) {
  return collection(db, 'users', uid, 'sections');
}

export function subscribeToSections(
  uid: string,
  cb: (sections: Section[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    sectionsCol(uid),
    (snap) => {
      const sections: Section[] = snap.docs.map((d) => {
        const data = d.data() as Omit<Section, 'id'>;
        return { ...data, id: d.id };
      });
      sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
      cb(sections);
    },
    (err) => onError?.(err),
  );
}

export async function upsertSection(uid: string, section: Section): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'sections', section.id), section, { merge: true });
}
