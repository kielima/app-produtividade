import { supabase } from '../lib/supabase';
import type { TaskComment, TaskCommentAnexo } from '../types';

export type Unsubscribe = () => void;

const BUCKET = 'task-comment-anexos';
// Como no app da Sudeste: a URL assinada vale por pouco tempo, então nunca
// fica guardada — é pedida de novo a cada vez que o anexo é mostrado.
const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_ANEXO_BYTES = 10 * 1024 * 1024;
const TIPOS_ACEITOS = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
];

interface CommentRow {
  id: string;
  user_id: string;
  task_id: string;
  texto: string;
  autor_nome: string | null;
  autor_email: string | null;
  criado_em: string;
}

interface AnexoRow {
  id: string;
  user_id: string;
  comment_id: string;
  path: string;
  nome: string;
  tipo: string;
  bytes: number;
  criado_em: string;
}

function anexoFromRow(row: AnexoRow): TaskCommentAnexo {
  return { id: row.id, path: row.path, nome: row.nome, tipo: row.tipo, bytes: row.bytes };
}

function commentFromRow(row: CommentRow, anexoRows: AnexoRow[]): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    texto: row.texto,
    autorNome: row.autor_nome,
    autorEmail: row.autor_email,
    criadoEm: row.criado_em,
    anexos: anexoRows
      .filter((a) => a.comment_id === row.id)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em))
      .map(anexoFromRow),
  };
}

/**
 * Assina os comentários de tarefa do usuário, com os anexos já juntados.
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
  const anexos = new Map<string, AnexoRow>();

  function emit() {
    if (cancelled) return;
    const rows = Array.from(comments.values()).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const anexoList = Array.from(anexos.values());
    cb(rows.map((r) => commentFromRow(r, anexoList)));
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

    const ids = Array.from(comments.keys());
    if (ids.length > 0) {
      const { data: anexoData, error: anexoError } = await supabase
        .from('task_comment_anexos')
        .select('*')
        .eq('user_id', uid)
        .in('comment_id', ids);
      if (cancelled) return;
      if (anexoError) {
        onError?.(new Error(anexoError.message));
        return;
      }
      anexos.clear();
      for (const row of (anexoData ?? []) as AnexoRow[]) anexos.set(row.id, row);
    }
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
    .on(
      // Anexos não têm `task_id` próprio, então o filtro aqui é só por
      // usuário; um anexo de outra tarefa fica no mapa sem uso quando esta
      // assinatura é a de uma tarefa só (`commentFromRow` filtra por
      // `comment_id`) — inofensivo num app de uso pessoal.
      'postgres_changes',
      { event: '*', schema: 'produtividade', table: 'task_comment_anexos', filter: `user_id=eq.${uid}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as Record<string, unknown>;
          if (typeof old.id === 'string') anexos.delete(old.id);
        } else {
          const row = payload.new as AnexoRow;
          anexos.set(row.id, row);
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

/**
 * Assina só a CONTAGEM de comentários por tarefa (sem texto nem anexos) —
 * usada para o selinho no card de tarefa, que precisa saber de todas as
 * tarefas de uma vez sem baixar o conteúdo de cada comentário.
 */
export function subscribeToTaskCommentCounts(
  uid: string,
  cb: (counts: Record<string, number>) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let cancelled = false;
  const taskIdById = new Map<string, string>();

  function emit() {
    if (cancelled) return;
    const counts: Record<string, number> = {};
    for (const taskId of taskIdById.values()) counts[taskId] = (counts[taskId] ?? 0) + 1;
    cb(counts);
  }

  void supabase
    .from('task_comments')
    .select('id, task_id')
    .eq('user_id', uid)
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        onError?.(new Error(error.message));
        return;
      }
      taskIdById.clear();
      for (const row of (data ?? []) as Array<{ id: string; task_id: string }>) {
        taskIdById.set(row.id, row.task_id);
      }
      emit();
    });

  const channel = supabase
    .channel(`rt:task_comments_count:${uid}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'produtividade', table: 'task_comments', filter: `user_id=eq.${uid}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as Record<string, unknown>;
          if (typeof old.id === 'string') taskIdById.delete(old.id);
        } else {
          const row = payload.new as CommentRow;
          taskIdById.set(row.id, row.task_id);
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
  return commentFromRow(data as CommentRow, []);
}

export async function deleteTaskComment(uid: string, commentId: string): Promise<void> {
  // Os anexos somem da LINHA por `on delete cascade`, mas o ARQUIVO no
  // Storage não — precisa ser apagado explicitamente antes.
  const { data: anexoRows } = await supabase
    .from('task_comment_anexos')
    .select('path')
    .eq('user_id', uid)
    .eq('comment_id', commentId);
  const paths = (anexoRows ?? []).map((a) => (a as { path: string }).path);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from('task_comments').delete().eq('id', commentId).eq('user_id', uid);
  if (error) throw new Error(error.message);
}

function extensaoDoTipo(tipo: string): string {
  const porTipo: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
  };
  return porTipo[tipo] ?? 'bin';
}

export async function uploadTaskCommentAnexo(
  uid: string,
  commentId: string,
  file: File,
): Promise<TaskCommentAnexo> {
  if (!TIPOS_ACEITOS.includes(file.type)) {
    throw new Error('Formato não aceito: só foto (PNG, JPEG, WebP, GIF) ou PDF.');
  }
  if (file.size > MAX_ANEXO_BYTES) {
    throw new Error(`O arquivo passou de ${Math.round(MAX_ANEXO_BYTES / 1048576)} MB.`);
  }
  const path = `${uid}/${commentId}/${crypto.randomUUID()}.${extensaoDoTipo(file.type)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
  });
  if (uploadError) throw new Error(uploadError.message);
  const { data, error } = await supabase
    .from('task_comment_anexos')
    .insert({
      user_id: uid,
      comment_id: commentId,
      path,
      nome: file.name || 'arquivo',
      tipo: file.type,
      bytes: file.size,
    })
    .select('*')
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(error.message);
  }
  return anexoFromRow(data as AnexoRow);
}

export async function deleteTaskCommentAnexo(uid: string, anexo: TaskCommentAnexo): Promise<void> {
  await supabase.storage.from(BUCKET).remove([anexo.path]);
  const { error } = await supabase
    .from('task_comment_anexos')
    .delete()
    .eq('id', anexo.id)
    .eq('user_id', uid);
  if (error) throw new Error(error.message);
}

export async function signedUrlForAnexo(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(error?.message ?? 'Não foi possível abrir o anexo.');
  return data.signedUrl;
}
