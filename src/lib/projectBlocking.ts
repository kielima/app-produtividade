import type { Project, Task } from '../types';

/** Patch a aplicar a um projeto para refletir mudança de bloqueio. */
export interface BlockTransition {
  id: string;
  patch: Partial<Project>;
}

/**
 * Decide quais projetos precisam ser pausados (por ficarem bloqueados por uma
 * dependência não concluída) ou revertidos ao status anterior (quando a
 * dependência atinge 100% das tarefas, deixa de existir ou perde tarefas).
 *
 * Ao pausar, memoriza o status anterior em `statusBeforeBlock`. Ao reverter,
 * restaura esse status (se o projeto ainda estiver `Pausado`) e limpa o campo.
 * É uma função pura — só calcula os patches, não os aplica.
 */
export function computeBlockTransitions(
  projects: ReadonlyArray<Project>,
  tasks: ReadonlyArray<Task>,
): BlockTransition[] {
  const projectIds = new Set(projects.map((p) => p.id));
  const out: BlockTransition[] = [];

  for (const p of projects) {
    let blocked = false;
    if (p.dependsOn && projectIds.has(p.dependsOn)) {
      const depTasks = tasks.filter((t) => t.section === p.dependsOn);
      blocked = depTasks.length > 0 && !depTasks.every((t) => t.checked);
    }

    if (blocked) {
      // Bloqueia: pausa e guarda o status anterior (uma única vez).
      if (p.status !== 'Pausado') {
        out.push({
          id: p.id,
          patch: { status: 'Pausado', statusBeforeBlock: p.status },
        });
      }
    } else if (p.statusBeforeBlock) {
      // Bloqueio levantado: reverte para o status anterior e limpa o snapshot.
      const patch: Partial<Project> = { statusBeforeBlock: null };
      if (p.status === 'Pausado') patch.status = p.statusBeforeBlock;
      out.push({ id: p.id, patch });
    }
  }

  return out;
}
