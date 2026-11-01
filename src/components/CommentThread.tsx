import { useEffect, useState } from 'react';
import { AutorAvatar } from './TaskComments';
import { useSupabaseUser } from '../lib/useSession';
import {
  addThreadComment,
  deleteThreadComment,
  subscribeToThread,
  type TipoDeAlvo,
} from '../repositories/commentThreadRepo';
import type { ThreadComment } from '../types';

function formatarQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Comentários (só texto) de uma anotação ou de um projeto — onde o
 * secretário agendado deixa perguntas para melhorar o contexto e sugestões.
 * Responda aqui mesmo; ele lê na próxima passada.
 */
export function CommentThread({
  uid,
  tipo,
  alvoId,
  placeholder = 'Escreva um comentário…',
}: {
  uid: string;
  tipo: TipoDeAlvo;
  alvoId: string;
  placeholder?: string;
}) {
  const [user] = useSupabaseUser();
  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    return subscribeToThread(
      tipo,
      uid,
      alvoId,
      (next) => {
        setComments(next);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, [tipo, uid, alvoId]);

  async function submit() {
    if (!texto.trim()) return;
    setSending(true);
    setError(null);
    try {
      await addThreadComment(tipo, uid, alvoId, texto, {
        nome: user?.displayName ?? null,
        email: user?.email ?? null,
      });
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
      await deleteThreadComment(tipo, uid, id);
      setComments((prev) => prev.filter((c) => c.id !== id));
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
                  <strong>{c.autorNome || c.autorEmail || 'alguém'}</strong>
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
                <p className="task-comment-texto">{c.texto}</p>
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
          placeholder={placeholder}
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
