import type { Firestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { taskSectionId } from '../../../src/lib/parser';

interface MemoryWriteOptions {
  uid: string;
  dryRun: boolean;
  memoryDir: string;
}

interface MemoryStats {
  glossary: boolean;
  claude: boolean;
  projectsContext: number;
  automations: number;
  context: number;
  other: number;
}

function readFileSafe(p: string): string | null {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

async function setDoc(
  db: Firestore,
  pathSegs: string[],
  content: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  let ref: FirebaseFirestore.DocumentReference = db.collection(pathSegs[0]!).doc(pathSegs[1]!);
  for (let i = 2; i < pathSegs.length; i += 2) {
    ref = ref.collection(pathSegs[i]!).doc(pathSegs[i + 1]!);
  }
  await ref.set({ content, updatedAt: new Date() }, { merge: true });
}

async function writeDirAsCollection(
  db: Firestore,
  dirPath: string,
  uid: string,
  subcoll: string,
  dryRun: boolean,
): Promise<number> {
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));
  let count = 0;
  for (const file of files) {
    const slug = taskSectionId(file.replace(/\.md$/, ''));
    const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
    await setDoc(
      db,
      ['users', uid, 'memory', subcoll, 'docs', slug],
      content,
      dryRun,
    );
    count++;
  }
  return count;
}

/**
 * Migra `memory/*.md` para Firestore. Mapeamento conforme plano §3.3:
 * - memory/glossary.md → users/{uid}/memory/glossary
 * - CLAUDE.md (na raiz da pasta de origem) → users/{uid}/memory/claude
 * - memory/projects/*.md → users/{uid}/memory/projectsContext/docs/{slug}
 * - memory/automations/*.md → users/{uid}/memory/automations/docs/{slug}
 * - memory/context/*.md → users/{uid}/memory/context/docs/{slug}
 * - memory/backup/* → ignorado (D6)
 */
export async function writeMemory(db: Firestore, opts: MemoryWriteOptions): Promise<MemoryStats> {
  const { uid, dryRun, memoryDir } = opts;
  const stats: MemoryStats = {
    glossary: false,
    claude: false,
    projectsContext: 0,
    automations: 0,
    context: 0,
    other: 0,
  };

  const glossary = readFileSafe(path.join(memoryDir, 'glossary.md'));
  if (glossary) {
    await setDoc(db, ['users', uid, 'memory', 'glossary'], glossary, dryRun);
    stats.glossary = true;
  }

  // CLAUDE.md vive na pasta-pai (raiz do vault), não em memory/
  const claudeMd = readFileSafe(path.resolve(memoryDir, '..', 'CLAUDE.md'));
  if (claudeMd) {
    await setDoc(db, ['users', uid, 'memory', 'claude'], claudeMd, dryRun);
    stats.claude = true;
  }

  stats.projectsContext = await writeDirAsCollection(
    db,
    path.join(memoryDir, 'projects'),
    uid,
    'projectsContext',
    dryRun,
  );
  stats.automations = await writeDirAsCollection(
    db,
    path.join(memoryDir, 'automations'),
    uid,
    'automations',
    dryRun,
  );
  stats.context = await writeDirAsCollection(
    db,
    path.join(memoryDir, 'context'),
    uid,
    'context',
    dryRun,
  );

  return stats;
}
