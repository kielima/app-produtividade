import { useEffect, useMemo, useState } from 'react';
import { subscribeToSections } from '../repositories/sectionsRepo';
import { subscribeToTasks } from '../repositories/tasksRepo';
import { buildDependencyMap } from './score';
import type { ScoreContext, Section, Task } from '../types';

export interface UserData {
  tasks: Task[];
  sections: Section[];
  sectionMap: Record<string, Section>;
  ctx: ScoreContext;
  error: Error | null;
}

/**
 * Assina tasks + sections em real-time e computa o contexto de score
 * (depMap + potentialScoreMap). Compartilhado por todas as views do
 * grupo Tarefas — evita re-subscribe ao trocar de view.
 */
export function useUserData(uid: string): UserData {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const u1 = subscribeToTasks(uid, setTasks, setError);
    const u2 = subscribeToSections(uid, setSections, setError);
    return () => {
      u1();
      u2();
    };
  }, [uid]);

  const sectionMap = useMemo(() => {
    const m: Record<string, Section> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const ctx = useMemo(
    () =>
      buildDependencyMap(
        tasks.map((task) => ({ task, section: sectionMap[task.section] ?? null })),
      ),
    [tasks, sectionMap],
  );

  return { tasks, sections, sectionMap, ctx, error };
}
