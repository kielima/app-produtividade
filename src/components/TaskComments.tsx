import { useEffect, useMemo, useState } from 'react';
import {
  addTaskComment,
  deleteTaskComment,
  subscribeToTaskComments,
} from '../repositories/taskCommentsRepo';
import { useSupabaseUser } from '../lib/useSession';
import { useResources, resourcePhotoSrc } from '../lib/resources';
import type { TaskComment } from '../types';

const FORMATO_DATA: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };

function formatarQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', FORMATO_DATA);
}

function nomeDoAutor(c: Pick<TaskComment, 'autorNome' | 'autorEmail'>): string {
  return c.autorNome || c.autorEmail || 'alguém';
}

/**
 * Avatar do autor de um comentário: a foto do recurso com o mesmo nome (ex.:
 * "Claude", quando quem comenta é o secretário agendado) ou a inicial.
 */
export function AutorAvatar({ comment }: { comment: Pick<TaskComment, 'autorNome' | 'autorEmail'> }) {
  const { resources } = useResources();
  const nome = (comment.autorNome ?? '').trim().toLowerCase();
  const recurso = nome ? resources.find((r) => r.nome.trim().toLowerCase() === nome) : undefined;
  const src = resourcePhotoSrc(recurso?.foto);
  return (
    <span className="task-comment-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" /> : nomeDoAutor(comment).charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Comentários de uma tarefa: só texto + autor + quando. Fotos e arquivos são
 * da própria tarefa (seção Anexos, ver TaskAnexos.tsx), não da conversa.
 * RLS isola por `user_id` como o resto do app; `autorNome`/`autorEmail` são
 * só exibição.
 */
export function TaskComments({ uid, taskId }: { uid: string; taskId: string }) {
  const [user] = useSupabaseUser();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToTaskComments(
      uid,
      (next) => {
        setComments(next);
        setLoading(false);
      },
      {
        taskId,
        onError: (e) => {
          setError(e.message);
          setLoading(false);
        },
      },
    );
    return unsub;
  }, [uid, taskId]);

  const autor = useMemo(
    () => ({ email: user?.email ?? null, nome: user?.displayName ?? null }),
    [user?.email, user?.displayName],
  );

  async function submit() {
    if (!texto.trim()) return;
    setSending(true);
    setError(null);
    try {
      await addTaskComment(uid, taskId, texto, autor);
      setTexto('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o comentário.');
    } finally {
      setSending(false);
    }
  }

  async function remover(id: string) {
    if (!window.confirm('Apagar este comentário?')) return;
    try {
      await deleteTaskComment(uid, id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível apagar o comentário.');
    }
  }

  return (
    <section className="task-detail-section task-comments">
      <div className="task-detail-section-header">
        <h3>Comentários{comments.length > 0 ? ` (${comments.length})` : ''}</h3>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="task-comments-lista">
          {comments.map((c) => (
            <li key={c.id} className="task-comment-item">
              <AutorAvatar comment={c} />
              <div className="task-comment-body">
                <div className="task-comment-meta">
                  <strong>{nomeDoAutor(c)}</strong>
                  <span className="muted">{formatarQuando(c.criadoEm)}</span>
                  <button
                    type="button"
                    className="task-comment-apagar"
                    onClick={() => remover(c.id)}
                    aria-label="apagar este comentário"
                    title="apagar este comentário"
                  >
                    ×
                  </button>
                </div>
                {c.texto && <p className="task-comment-texto">{c.texto}</p>}
              </div>
            </li>
          ))}
          {comments.length === 0 && <p className="muted task-comments-vazio">Nenhum comentário.</p>}
        </ul>
      )}

      <div className="task-comment-compositor">
        <textarea
          className="task-comment-input"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva um comentário…"
          rows={2}
          disabled={sending}
        />
        <div className="task-comment-compositor-actions">
          <button
            type="button"
            className="btn-secondary task-comment-enviar"
            disabled={sending || !texto.trim()}
            onClick={submit}
          >
            {sending ? 'enviando…' : 'comentar'}
          </button>
        </div>
      </div>
    </section>
  );
}
