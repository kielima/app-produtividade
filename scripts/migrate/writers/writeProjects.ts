import type { Firestore } from 'firebase-admin/firestore';
import type { Project } from '../../../src/types';

const BATCH_LIMIT = 450;

export async function writeProjects(
  db: Firestore,
  projects: Project[],
  opts: { uid: string; dryRun: boolean },
): Promise<number> {
  if (opts.dryRun) return projects.length;
  const ref = db.collection('users').doc(opts.uid).collection('projects');
  let count = 0;
  for (let i = 0; i < projects.length; i += BATCH_LIMIT) {
    const slice = projects.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    slice.forEach((p, idx) => {
      batch.set(ref.doc(p.id), { ...p, order: i + idx }, { merge: true });
    });
    await batch.commit();
    count += slice.length;
  }
  return count;
}
