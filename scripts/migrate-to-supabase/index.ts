#!/usr/bin/env node
// =============================================================
// Migração de dados: Firestore (Firebase) → Postgres (Supabase).
//
// Lê tudo em users/{uid}/** via Admin SDK (bypassa firestore.rules) e grava
// no projeto Supabase via service_role key (bypassa RLS). Só LÊ do
// Firestore — nunca escreve nem apaga nada lá. Ver PLANO_MIGRACAO_SUPABASE.md
// §5.
//
// Como os ids no Postgres são os MESMOS ids de documento do Firestore
// (correção feita na Fase 3 — ver supabase/migrations/*_fix_ids_to_text_*),
// não é preciso remapear ids como um schema com PK numérica exigiria. As
// duas únicas referências auto-recursivas (tasks.parent_id, projects.
// depends_on) são preenchidas numa segunda passada, depois que todas as
// linhas já existem — evita violação de FK ao inserir um filho antes do pai
// no mesmo lote.
//
// Uso:
//   npm run migrate:supabase -- [--dry-run]
//
// Variáveis de ambiente:
//   GOOGLE_APPLICATION_CREDENTIALS  service account JSON do Firebase (Admin SDK)
//   MIGRATE_UID                    uid do usuário no Firebase Auth (origem)
//   MIGRATE_SUPABASE_UID           uid do usuário no Supabase Auth (destino, UUID)
//   SUPABASE_URL                   URL do projeto Supabase
//   SUPABASE_SERVICE_ROLE_KEY      service role key (bypassa RLS)
// =============================================================

import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminDb } from '../migrate/firebase-admin';

const CHUNK_SIZE = 150;

function parseCliArgs(): { dryRun: boolean } {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(`
Uso:
  npm run migrate:supabase -- [--dry-run]

Variáveis de ambiente obrigatórias:
  GOOGLE_APPLICATION_CREDENTIALS, MIGRATE_UID, MIGRATE_SUPABASE_UID,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

--dry-run: lê o Firestore e mostra as contagens sem escrever no Supabase.
`);
    process.exit(0);
  }
  return { dryRun: values['dry-run'] === true };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Erro: variável de ambiente ${name} é obrigatória.`);
    process.exit(1);
  }
  return v;
}

// Firestore Timestamp | {seconds} | Date | string | null → ISO string | null
function toIso(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw) {
    const fn = (raw as { toDate?: unknown }).toDate;
    if (typeof fn === 'function') return (fn.call(raw) as Date).toISOString();
  }
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'object' && raw !== null && 'seconds' in raw) {
    return new Date((raw as { seconds: number }).seconds * 1000).toISOString();
  }
  if (typeof raw === 'string') return raw;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Timeouts/resets de rede num lote isolado são comuns em runs longos (milhares
// de linhas); retentar o MESMO lote é seguro porque upsert é idempotente.
async function upsertChunked(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  dryRun: boolean,
): Promise<number> {
  if (rows.length === 0) return 0;
  if (dryRun) return rows.length;
  const backoffsMs = [0, 2_000, 5_000, 10_000];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const slice = rows.slice(i, i + CHUNK_SIZE);
    let lastError: string | undefined;
    let ok = false;
    for (const backoff of backoffsMs) {
      if (backoff > 0) {
        console.log(`  [retry] ${table} lote ${i}-${i + slice.length}: tentando de novo em ${backoff}ms...`);
        await sleep(backoff);
      }
      const { error } = await supabase.from(table).upsert(slice);
      if (!error) {
        ok = true;
        break;
      }
      lastError = error.message;
    }
    if (!ok) throw new Error(`upsert ${table} falhou (lote ${i}-${i + slice.length}): ${lastError}`);
  }
  return rows.length;
}

async function main() {
  const { dryRun } = parseCliArgs();
  const firestoreUid = requireEnv('MIGRATE_UID');
  const supabaseUid = requireEnv('MIGRATE_SUPABASE_UID');
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const mode = dryRun ? 'DRY-RUN' : 'ESCRITA REAL';
  console.log(`\n=== Migração Firestore → Supabase (${mode}) ===`);
  console.log(`Firestore uid: ${firestoreUid}`);
  console.log(`Supabase uid:  ${supabaseUid}\n`);

  const db = adminDb();
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const userRef = db.collection('users').doc(firestoreUid);

  // -----------------------------------------------------------
  // 1. Ler tudo do Firestore
  // -----------------------------------------------------------
  const [
    tasksSnap,
    completedTasksSnap,
    projectsSnap,
    sectionsSnap,
    notesSnap,
    glickoSnap,
    readingItemsSnap,
    glossarySnap,
    claudeSnap,
    projectsContextSnap,
    automationsSnap,
    contextSnap,
  ] = await Promise.all([
    userRef.collection('tasks').get(),
    userRef.collection('completedTasks').get(),
    userRef.collection('projects').get(),
    userRef.collection('sections').get(),
    userRef.collection('notes').get(),
    userRef.collection('glicko').get(),
    userRef.collection('readingItems').get(),
    userRef.collection('memory').doc('glossary').get(),
    userRef.collection('memory').doc('claude').get(),
    userRef.collection('memory').doc('projectsContext').collection('docs').get(),
    userRef.collection('memory').doc('automations').collection('docs').get(),
    userRef.collection('memory').doc('context').collection('docs').get(),
  ]);

  const annotationsByItem = new Map<string, FirebaseFirestore.QuerySnapshot>();
  for (const itemDoc of readingItemsSnap.docs) {
    const annSnap = await itemDoc.ref.collection('annotations').get();
    annotationsByItem.set(itemDoc.id, annSnap);
  }
  const totalAnnotations = [...annotationsByItem.values()].reduce((n, s) => n + s.size, 0);

  console.log('Lido do Firestore:');
  console.log(`  tasks: ${tasksSnap.size} (+ ${completedTasksSnap.size} legado em completedTasks)`);
  console.log(`  projects: ${projectsSnap.size} (+ ${sectionsSnap.size} legado em sections)`);
  console.log(`  notes: ${notesSnap.size}`);
  console.log(`  glicko: ${glickoSnap.size}`);
  console.log(`  readingItems: ${readingItemsSnap.size} (+ ${totalAnnotations} annotations)`);
  console.log(
    `  memory: glossary=${glossarySnap.exists ? '✓' : '–'} claude=${claudeSnap.exists ? '✓' : '–'} ` +
      `projectsContext=${projectsContextSnap.size} automations=${automationsSnap.size} context=${contextSnap.size}\n`,
  );

  // -----------------------------------------------------------
  // 2. Transformar em linhas do Postgres
  // -----------------------------------------------------------

  // --- projects (+ sections legado, só pra quem não tem projeto com o mesmo id) ---
  const projectIds = new Set(projectsSnap.docs.map((d) => d.id));
  const projectRows: Record<string, unknown>[] = projectsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      user_id: supabaseUid,
      name: data.name ?? d.id,
      area: data.area ?? '',
      categories: Array.isArray(data.categories)
        ? data.categories
        : typeof data.category === 'string' && data.category.trim()
          ? [data.category]
          : [],
      status: data.status || 'A iniciar',
      priority: data.priority ?? '',
      moscow: data.moscow || 'wont',
      objective: data.objective ?? '',
      current_status: data.currentStatus ?? '',
      next_steps: data.nextSteps ?? '',
      deadline: data.deadline ?? '',
      estimated_duration: data.estimatedDuration ?? '',
      notes: data.notes ?? '',
      order: data.order ?? null,
      status_before_block: data.statusBeforeBlock ?? null,
    };
  });
  const projectDependsOn = new Map<string, string>();
  for (const d of projectsSnap.docs) {
    const dep = d.data().dependsOn;
    if (dep) projectDependsOn.set(d.id, dep);
  }
  for (const d of sectionsSnap.docs) {
    if (projectIds.has(d.id)) continue; // já existe como projeto — sections é só legado
    const data = d.data();
    projectRows.push({
      id: d.id,
      user_id: supabaseUid,
      name: data.name ?? d.id,
      area: '',
      categories: [],
      status: 'A iniciar',
      priority: '',
      moscow: data.moscow || 'wont',
      objective: '',
      current_status: '',
      next_steps: '',
      deadline: '',
      estimated_duration: '',
      notes: '',
      order: data.order ?? null,
      status_before_block: null,
    });
  }

  // --- tasks (+ completedTasks legado) ---
  const taskRows: Record<string, unknown>[] = tasksSnap.docs.map((d) => rowFromTaskDoc(d, supabaseUid));
  const taskParentId = new Map<string, string>();
  for (const d of tasksSnap.docs) {
    const parentId = d.data().parentId;
    if (parentId) taskParentId.set(d.id, parentId);
  }
  for (const d of completedTasksSnap.docs) {
    const data = d.data();
    const row = rowFromTaskDoc(d, supabaseUid);
    row.checked = true;
    row.completed_at = toIso(data.archivedAt ?? data.completedAt);
    row.completed_from_section_name = data.archivedFromSectionName ?? data.completedFromSectionName ?? null;
    taskRows.push(row);
    if (data.parentId) taskParentId.set(d.id, data.parentId);
  }

  function rowFromTaskDoc(d: FirebaseFirestore.QueryDocumentSnapshot, uid: string): Record<string, unknown> {
    const data = d.data();
    return {
      id: d.id,
      user_id: uid,
      task_id: data.taskId ?? null,
      title: data.title ?? '',
      note: data.note ?? '',
      checked: data.checked === true,
      in_progress: data.inProgress === true,
      moscow: data.moscow ?? '',
      modo: data.modo ?? 'manual',
      esforco: data.esforco ?? '',
      deadline: data.deadline ?? '',
      added_date: data.addedDate ?? '',
      depends_on: Array.isArray(data.dependsOn) ? data.dependsOn : [],
      subtasks: Array.isArray(data.subtasks) ? data.subtasks : [],
      order: data.order ?? null,
      project_id: data.section || null,
      completed_at: toIso(data.completedAt),
      completed_from_section_name: data.completedFromSectionName ?? null,
      snoozed_until: data.snoozedUntil ?? null,
      source_item_id: data.sourceItemId ?? null,
      source_annotation_id: data.sourceAnnotationId ?? null,
    };
  }

  // --- notes ---
  const noteRows: Record<string, unknown>[] = notesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      user_id: supabaseUid,
      title: data.title ?? '',
      note: data.note ?? '',
      items: Array.isArray(data.items) ? data.items : [],
      added_date: data.addedDate ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      pinned: data.pinned === true,
      project_id: data.projectId ?? null,
      color: data.color ?? null,
      source_item_id: data.sourceItemId ?? null,
      source_annotation_id: data.sourceAnnotationId ?? null,
    };
  });

  // --- reading_items ---
  const readingItemRows: Record<string, unknown>[] = readingItemsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      user_id: supabaseUid,
      drive_file_id: data.driveFileId ?? '',
      file_name: data.fileName ?? null,
      folder_id: data.folderId ?? null,
      folder_path: data.folderPath ?? null,
      format: data.format === 'epub' ? 'epub' : 'pdf',
      title: data.title ?? '',
      authors: Array.isArray(data.authors) ? data.authors : [],
      item_type: data.itemType ?? 'other',
      doi: data.doi ?? null,
      isbn: data.isbn ?? null,
      issn: data.issn ?? null,
      year: data.year ?? null,
      publication: data.publication ?? null,
      tags: Array.isArray(data.tags) ? data.tags : [],
      added_date: data.addedDate ?? '',
      last_opened_at: data.lastOpenedAt ?? null,
      auto_classified_at: data.autoClassifiedAt ?? null,
      reading_status: data.readingStatus ?? 'to-read',
      current_page: data.currentPage ?? null,
      project_id: data.projectId ?? null,
    };
  });

  // --- normaliza project_id órfão (aponta pra um projeto que não existe mais
  // — o Firestore não tem FK e deixou isso "pendurado" silenciosamente ao
  // longo dos anos; o Postgres recusaria a escrita). Trata como "sem
  // projeto", igual a UI já mostraria.
  const finalProjectIds = new Set(projectRows.map((r) => r.id as string));
  let orphanedRefs = 0;
  for (const rows of [taskRows, noteRows, readingItemRows]) {
    for (const row of rows) {
      const pid = row.project_id as string | null;
      if (pid && !finalProjectIds.has(pid)) {
        row.project_id = null;
        orphanedRefs++;
      }
    }
  }
  if (orphanedRefs > 0) {
    console.log(`  [aviso] ${orphanedRefs} referência(s) a projeto inexistente zerada(s) (tratadas como "sem projeto").`);
  }

  // --- annotations (dependem de reading_items já existirem) ---
  const annotationRows: Record<string, unknown>[] = [];
  for (const [itemId, snap] of annotationsByItem) {
    for (const d of snap.docs) {
      const data = d.data();
      annotationRows.push({
        id: d.id,
        user_id: supabaseUid,
        reading_item_id: itemId,
        page: typeof data.page === 'number' ? data.page : 1,
        type: data.type ?? 'highlight',
        color: data.color ?? '#ffd54a',
        rects: data.rects ?? null,
        text: data.text ?? null,
        title: data.title ?? null,
        comment: data.comment ?? null,
        strokes: data.strokes ?? null,
        anchor: data.anchor ?? null,
        cfi: data.cfi ?? null,
        created_at: data.createdAt ?? null,
        linked_task_id: data.linkedTaskId ?? null,
        linked_note_id: data.linkedNoteId ?? null,
      });
    }
  }

  // --- project_ratings (glicko) — project_id é a PK (não anulável), então
  // ratings de projetos que não existem mais são descartados (não têm pra
  // que servir sem o projeto).
  const droppedRatings: string[] = [];
  const ratingRows: Record<string, unknown>[] = glickoSnap.docs
    .filter((d) => {
      const exists = finalProjectIds.has(d.id);
      if (!exists) droppedRatings.push(d.id);
      return exists;
    })
    .map((d) => {
      const data = d.data();
      return {
        project_id: d.id,
        user_id: supabaseUid,
        r: typeof data.r === 'number' ? data.r : 1500,
        rd: typeof data.rd === 'number' ? data.rd : 350,
        sigma: typeof data.sigma === 'number' ? data.sigma : 0.06,
      };
    });
  if (droppedRatings.length > 0) {
    console.log(
      `  [aviso] ${droppedRatings.length} rating(s) de glicko descartado(s) (projeto inexistente): ${droppedRatings.join(', ')}`,
    );
  }

  // --- memory_docs ---
  const memoryRows: Record<string, unknown>[] = [];
  if (glossarySnap.exists) {
    memoryRows.push({
      user_id: supabaseUid,
      namespace: 'glossary',
      slug: '',
      content: glossarySnap.data()?.content ?? '',
    });
  }
  if (claudeSnap.exists) {
    memoryRows.push({
      user_id: supabaseUid,
      namespace: 'claude',
      slug: '',
      content: claudeSnap.data()?.content ?? '',
    });
  }
  for (const [namespace, snap] of [
    ['projects_context', projectsContextSnap],
    ['automations', automationsSnap],
    ['context', contextSnap],
  ] as const) {
    for (const d of snap.docs) {
      memoryRows.push({ user_id: supabaseUid, namespace, slug: d.id, content: d.data().content ?? '' });
    }
  }

  // -----------------------------------------------------------
  // 3. Escrever no Supabase, respeitando dependências de FK.
  //    parent_id/depends_on (auto-referências) ficam null na primeira
  //    passada e são preenchidos depois, quando todas as linhas já existem.
  // -----------------------------------------------------------
  const written = {
    projects: await upsertChunked(supabase, 'projects', projectRows, dryRun),
    tasks: await upsertChunked(supabase, 'tasks', taskRows, dryRun),
    notes: await upsertChunked(supabase, 'notes', noteRows, dryRun),
    readingItems: await upsertChunked(supabase, 'reading_items', readingItemRows, dryRun),
    annotations: await upsertChunked(supabase, 'annotations', annotationRows, dryRun),
    projectRatings: await upsertChunked(supabase, 'project_ratings', ratingRows, dryRun),
    memoryDocs: await upsertChunked(supabase, 'memory_docs', memoryRows, dryRun),
  };

  if (!dryRun) {
    const finalTaskIds = new Set(taskRows.map((r) => r.id as string));
    let droppedDependsOn = 0;
    let droppedParentId = 0;
    for (const [projectId, dependsOn] of projectDependsOn) {
      if (!finalProjectIds.has(dependsOn)) {
        droppedDependsOn++;
        continue; // referência a projeto que não existe mais — ignora, fica null
      }
      const { error } = await supabase
        .from('projects')
        .update({ depends_on: dependsOn })
        .eq('user_id', supabaseUid)
        .eq('id', projectId);
      if (error) throw new Error(`update projects.depends_on falhou (${projectId}): ${error.message}`);
    }
    for (const [taskId, parentId] of taskParentId) {
      if (!finalTaskIds.has(parentId)) {
        droppedParentId++;
        continue; // referência a tarefa que não existe mais — ignora, fica null
      }
      const { error } = await supabase
        .from('tasks')
        .update({ parent_id: parentId })
        .eq('user_id', supabaseUid)
        .eq('id', taskId);
      if (error) throw new Error(`update tasks.parent_id falhou (${taskId}): ${error.message}`);
    }
    if (droppedDependsOn > 0) console.log(`  [aviso] ${droppedDependsOn} projects.depends_on órfão(s) ignorado(s).`);
    if (droppedParentId > 0) console.log(`  [aviso] ${droppedParentId} tasks.parent_id órfão(s) ignorado(s).`);
  }

  console.log(`${dryRun ? 'Seria escrito' : 'Escrito'} no Supabase:`);
  console.log(`  projects: ${written.projects}`);
  console.log(`  tasks: ${written.tasks}`);
  console.log(`  notes: ${written.notes}`);
  console.log(`  reading_items: ${written.readingItems}`);
  console.log(`  annotations: ${written.annotations}`);
  console.log(`  project_ratings: ${written.projectRatings}`);
  console.log(`  memory_docs: ${written.memoryDocs}`);
  console.log(`  (+ auto-referências: ${projectDependsOn.size} projects.depends_on, ${taskParentId.size} tasks.parent_id)`);
  console.log(`\n=== ${mode} concluído. ===\n`);
}

main().catch((err) => {
  console.error('Falha na migração:', err);
  process.exit(1);
});
