import { useEffect, useMemo, useState } from 'react';
import { patchProject, subscribeToProjects } from '../repositories/projectsRepo';
import { subscribeToTasks } from '../repositories/tasksRepo';
import { migrateSectionsToProjects } from './migrateSectionsToProjects';
import { buildProjectScoreMap } from './projectRankScore';
import { buildDependencyMap } from './score';
import type { Project, ScoreContext, Task } from '../types';

export interface UserData {
  tasks: Task[];
  projects: Project[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
  error: Error | null;
}

/**
 * Assina tasks + projects em real-time e computa o contexto de score
 * (depMap + potentialScoreMap). Antes de assinar, garante que a migração
 * one-shot de sections → projects rodou (idempotente). Compartilhado por
 * todas as views do grupo Tarefas — evita re-subscribe ao trocar de view.
 */
export function useUserData(uid: string): UserData {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubTasks: (() => void) | undefined;
    let unsubProjects: (() => void) | undefined;

    (async () => {
      try {
        await migrateSectionsToProjects(uid);
      } catch {
        // segue mesmo se a migração falhar (próximo load tenta de novo)
      }
      if (cancelled) return;
      unsubTasks = subscribeToTasks(uid, setTasks, setError);
      unsubProjects = subscribeToProjects(uid, setProjects, setError);
    })();

    return () => {
      cancelled = true;
      unsubTasks?.();
      unsubProjects?.();
    };
  }, [uid]);

  const projectMap = useMemo(() => {
    const m: Record<string, Project> = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  const ctx = useMemo(() => {
    const projectScoreMap = buildProjectScoreMap(projects, tasks);
    return buildDependencyMap(
      tasks.map((task) => ({ task, section: projectMap[task.section] ?? null })),
      projectScoreMap,
    );
  }, [tasks, projects, projectMap]);

  // Auto-pausa projetos bloqueados por dependência não concluída.
  useEffect(() => {
    const projectIds = new Set(projects.map((p) => p.id));
    for (const p of projects) {
      if (!p.dependsOn || !projectIds.has(p.dependsOn)) continue;
      const depTasks = tasks.filter((t) => t.section === p.dependsOn);
      if (depTasks.length === 0) continue;
      const allDone = depTasks.every((t) => t.checked);
      if (!allDone && p.status !== 'Pausado') {
        patchProject(uid, p.id, { status: 'Pausado' });
      }
    }
  }, [uid, tasks, projects]);

  return { tasks, projects, projectMap, ctx, error };
}
