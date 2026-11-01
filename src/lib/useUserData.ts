import { useEffect, useMemo, useRef, useState } from 'react';
import { patchProject, subscribeToProjects } from '../repositories/projectsRepo';
import { subscribeToTasks, updateTaskScores } from '../repositories/tasksRepo';
import { subscribeToCommentSummary } from '../repositories/commentSummary';
import { computeBlockTransitions } from './projectBlocking';
import { buildProjectScoreMap } from './projectRankScore';
import { buildDependencyMap } from './score';
import { computeScoreUpdates, stableStringify } from './scoreSync';
import type { Project, ScoreContext, Task } from '../types';

export interface UserData {
  tasks: Task[];
  projects: Project[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
  // Quantos comentários cada tarefa tem, por `task.id` — alimenta o selinho
  // no TaskCard. Tarefa sem comentário não entra no mapa (ver TaskCard).
  commentCounts: Record<string, number>;
  // Tarefas e notas cujo último comentário é do Claude — o filtro "esperando
  // minha resposta" (ver src/lib/aguardaResposta.ts).
  aguardandoTarefas: Set<string>;
  aguardandoNotas: Set<string>;
  aguardandoProjetos: Set<string>;
  // true até a primeira carga de tarefas e projetos chegar — evita que as
  // views mostrem "nenhum item" enquanto a busca inicial está em voo.
  loading: boolean;
  error: Error | null;
}

/**
 * Assina tasks + projects em real-time e computa o contexto de score
 * (depMap + potentialScoreMap). Compartilhado pelas views do grupo Tarefas,
 * por Projetos e por Estatísticas — evita re-subscribe (e baixar de novo a
 * tabela inteira de tarefas) ao trocar de view.
 */
export function useUserData(uid: string): UserData {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [aguardandoTarefas, setAguardandoTarefas] = useState<Set<string>>(() => new Set());
  const [aguardandoNotas, setAguardandoNotas] = useState<Set<string>>(() => new Set());
  const [aguardandoProjetos, setAguardandoProjetos] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setTasksLoaded(false);
    setProjectsLoaded(false);
    const unsubTasks = subscribeToTasks(
      uid,
      (next) => {
        setTasks(next);
        setTasksLoaded(true);
      },
      setError,
    );
    const unsubProjects = subscribeToProjects(
      uid,
      (next) => {
        setProjects(next);
        setProjectsLoaded(true);
      },
      setError,
    );
    // A contagem de comentários é só um selinho no card: se ela falhar (ex.:
    // migration ainda não aplicada no banco), a lista de tarefas tem de
    // continuar aparecendo — por isso o erro vai para o console, não para
    // `setError`, que esconde a tela inteira.
    const unsubCommentCounts = subscribeToCommentSummary(
      'task_comments',
      'task_id',
      uid,
      (s) => {
        setCommentCounts(s.counts);
        setAguardandoTarefas(s.aguardando);
      },
      (err) => console.error('Falha ao carregar a contagem de comentários', err),
    );
    const unsubNoteComments = subscribeToCommentSummary(
      'note_comments',
      'note_id',
      uid,
      (s) => setAguardandoNotas(s.aguardando),
      (err) => console.error('Falha ao carregar os comentários das notas', err),
    );
    const unsubProjectComments = subscribeToCommentSummary(
      'project_comments',
      'project_id',
      uid,
      (s) => setAguardandoProjetos(s.aguardando),
      (err) => console.error('Falha ao carregar os comentários dos projetos', err),
    );
    return () => {
      unsubTasks();
      unsubProjects();
      unsubCommentCounts();
      unsubNoteComments();
      unsubProjectComments();
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

  // Auto-pausa projetos bloqueados por dependência não concluída e reverte
  // para o status anterior quando o bloqueio é levantado (dependência 100%).
  // Só depois da carga inicial: com os projetos já carregados e as tarefas
  // ainda não, todo projeto bloqueado pareceria desbloqueado.
  useEffect(() => {
    if (!tasksLoaded || !projectsLoaded) return;
    for (const { id, patch } of computeBlockTransitions(projects, tasks)) {
      patchProject(uid, id, patch);
    }
  }, [uid, tasks, projects, tasksLoaded, projectsLoaded]);

  // Mantém a coluna `score` do Supabase espelhando o score calculado aqui,
  // pra ferramentas fora do app (ex.: a skill de bom dia) poderem consultar
  // e explicar o score sem rodar a fórmula. Ver src/lib/scoreSync.ts.
  //
  // `sentRef` guarda o último valor enviado por tarefa: entre a gravação e o
  // eco do Realtime, cada evento de outra tarefa reemite a lista e recomputa
  // tudo — sem isto, as tarefas ainda não ecoadas seriam reenviadas.
  const sentRef = useRef(new Map<string, string>());
  useEffect(() => {
    if (!tasksLoaded || !projectsLoaded) return;
    const sent = sentRef.current;
    const pending = computeScoreUpdates(tasks, projectMap, ctx).filter(
      (u) => sent.get(u.docId) !== stableStringify(u),
    );
    if (pending.length === 0) return;
    for (const u of pending) sent.set(u.docId, stableStringify(u));
    updateTaskScores(pending).catch((err: unknown) => {
      for (const u of pending) sent.delete(u.docId);
      console.error('Falha ao gravar scores das tarefas', err);
    });
  }, [tasks, projectMap, ctx, tasksLoaded, projectsLoaded]);

  return {
    tasks,
    projects,
    projectMap,
    ctx,
    commentCounts,
    aguardandoTarefas,
    aguardandoNotas,
    aguardandoProjetos,
    loading: !tasksLoaded || !projectsLoaded,
    error,
  };
}
