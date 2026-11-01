import { supabase } from '../lib/supabase';
import type { TaskComment } from '../types';

export type Unsubscribe = () => void;

interface CommentRow {
  id: string;
  user_id: string;
  task_id: string;
  texto: string;
  autor_nome: string | null;
  autor_email: string | null;
  criado_em: string;
}

function commentFromRow(row: CommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    texto: row.texto,
    autorNome: row.autor_nome,
    autorEmail: row.autor_email,
    criadoEm: row.criado_em,
  };
}

/**
 * Assina os comentários de tarefa do usuário (só texto — anexos são da
 * tarefa, ver taskAnexosRepo.ts).
 * Sem `taskId`, traz os de TODAS as tarefas (usado só para contar quantos
 * cada uma tem — ver `subscribeToTaskCommentCounts`, mais barata para isso).
 * Com `taskId`, traz só os daquela tarefa — é o que a tela de detalhe usa.
 */
export function subscribeToTaskComments(
  uid: string,
  cb: (comments: TaskComment[]) => void,
  opts: { taskId?: string; onError?: (err: Error) => void } = {},
): Unsubscribe {
  const { taskId, onError } = opts;
  let cancelled = false;
  const comments = new Map<string, CommentRow>();

  function emit() {
    if (cancelled) return;
    const rows = Array.from(comments.values()).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    cb(rows.map(commentFromRow));
  }

  async function loadInitial() {
    let query = supabase.from('task_comments').select('*').eq('user_id', uid);
    if (taskId) query = query.eq('task_id', taskId);
    const { data, error } = await query;
    if (cancelled) return;
    if (error) {
      onError?.(new Error(error.message));
      return;
    }
    comments.clear();
    for (const row of (data ?? []) as CommentRow[]) comments.set(row.id, row);

    emit();
  }

  void loadInitial();

  const commentFilter = taskId ? `task_id=eq.${taskId}` : `user_id=eq.${uid}`;
  const scope = taskId ?? uid;
  const channel = supabase
    .channel(`rt:task_comments:${scope}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'produtividade', table: 'task_comments', filter: commentFilter },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as Record<string, unknown>;
          if (typeof old.id === 'string') comments.delete(old.id);
        } else {
          const row = payload.new as CommentRow;
          comments.set(row.id, row);
        }
        emit();
      },
    )
    .subscribe();

  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}

export interface ComentarAutor {
  email: string | null;
  nome: string | null;
}

export async function addTaskComment(
  uid: string,
  taskId: string,
  texto: string,
  autor: ComentarAutor,
): Promise<TaskComment> {
  const corpo = texto.trim();
  if (!corpo) throw new Error('O comentário não pode ficar vazio.');
  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      user_id: uid,
      task_id: taskId,
      texto: corpo.slice(0, 2000),
      autor_nome: autor.nome,
      autor_email: autor.email,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return commentFromRow(data as CommentRow);
}

export async function deleteTaskComment(uid: string, commentId: string): Promise<void> {
  const { error } = await supabase.from('task_comments').delete().eq('id', commentId).eq('user_id', uid);
  if (error) throw new Error(error.message);
}
