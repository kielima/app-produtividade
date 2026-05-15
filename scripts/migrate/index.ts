#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  assignTaskIds,
  parseProjectMarkdown,
  parseTaskMarkdown,
} from '../../src/lib/parser';
import { adminDb } from './firebase-admin';
import { writeMemory } from './writers/writeMemory';
import { writeProjects } from './writers/writeProjects';
import { writeTasks } from './writers/writeTasks';

interface Options {
  uid: string;
  dryRun: boolean;
  tasksFile?: string;
  projectsFile?: string;
  memoryDir?: string;
}

function parseCliArgs(): Options {
  const { values } = parseArgs({
    options: {
      uid: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      tasks: { type: 'string' },
      projects: { type: 'string' },
      memory: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(`
Uso:
  npm run migrate -- --uid <UID> [--dry-run] [--tasks <path>] [--projects <path>] [--memory <dir>]

Variáveis de ambiente (alternativa às flags):
  MIGRATE_UID              (== --uid)
  MIGRATE_TASKS_FILE       (== --tasks)
  MIGRATE_PROJECTS_FILE    (== --projects)
  MIGRATE_MEMORY_DIR       (== --memory)
  GOOGLE_APPLICATION_CREDENTIALS  (service account JSON do Admin SDK)

Comportamento:
  --dry-run  Conta o que seria escrito sem tocar no Firestore.
`);
    process.exit(0);
  }

  const uid = values.uid || process.env.MIGRATE_UID;
  if (!uid) {
    console.error('Erro: --uid (ou MIGRATE_UID) é obrigatório. Rode com --help.');
    process.exit(1);
  }

  return {
    uid,
    dryRun: values['dry-run'] === true,
    tasksFile: values.tasks || process.env.MIGRATE_TASKS_FILE,
    projectsFile: values.projects || process.env.MIGRATE_PROJECTS_FILE,
    memoryDir: values.memory || process.env.MIGRATE_MEMORY_DIR,
  };
}

function loadFile(p: string | undefined, label: string): string | null {
  if (!p) {
    console.log(`  [skip] ${label}: caminho não informado`);
    return null;
  }
  if (!fs.existsSync(p)) {
    console.warn(`  [warn] ${label}: arquivo não encontrado em ${p}`);
    return null;
  }
  return fs.readFileSync(p, 'utf-8');
}

async function main() {
  const opts = parseCliArgs();
  const mode = opts.dryRun ? 'DRY-RUN' : 'ESCRITA REAL';

  console.log(`\n=== Migração ${mode} → Firestore (uid=${opts.uid}) ===\n`);

  const db = adminDb();

  // --- Tarefas ---
  console.log('Tarefas:');
  const tasksMd = loadFile(opts.tasksFile, 'tasks');
  if (tasksMd) {
    const parsed = assignTaskIds(parseTaskMarkdown(tasksMd));
    const totalSections = parsed.sections.length;
    const totalTasks = parsed.sections.reduce(
      (sum, s) => sum + (parsed.tasks[s.id]?.length ?? 0),
      0,
    );
    console.log(`  parseado: ${totalSections} seções, ${totalTasks} tarefas`);
    const r = await writeTasks(db, parsed, { uid: opts.uid, dryRun: opts.dryRun });
    console.log(`  ${opts.dryRun ? 'seria escrito' : 'escrito'}: ${r.sections} seções, ${r.tasks} tarefas`);
  }

  // --- Projetos ---
  console.log('\nProjetos:');
  const projMd = loadFile(opts.projectsFile, 'projects');
  if (projMd) {
    const projects = parseProjectMarkdown(projMd);
    console.log(`  parseado: ${projects.length} projetos`);
    const n = await writeProjects(db, projects, { uid: opts.uid, dryRun: opts.dryRun });
    console.log(`  ${opts.dryRun ? 'seria escrito' : 'escrito'}: ${n} projetos`);
  }

  // --- Memória ---
  console.log('\nMemória:');
  if (opts.memoryDir && fs.existsSync(opts.memoryDir)) {
    const stats = await writeMemory(db, {
      uid: opts.uid,
      dryRun: opts.dryRun,
      memoryDir: path.resolve(opts.memoryDir),
    });
    console.log(
      `  glossary: ${stats.glossary ? '✓' : '–'} | CLAUDE.md: ${stats.claude ? '✓' : '–'} | ` +
        `projectsContext: ${stats.projectsContext} | automations: ${stats.automations} | context: ${stats.context}`,
    );
  } else {
    console.log('  [skip] memory: diretório não informado ou inexistente');
  }

  console.log(`\n=== ${mode} concluído. ===\n`);
}

main().catch((err) => {
  console.error('Falha na migração:', err);
  process.exit(1);
});
