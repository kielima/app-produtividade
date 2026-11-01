import { useEffect, useState } from 'react';
import { AutorAvatar } from './TaskComments';
import { useSupabaseUser } from '../lib/useSession';
import { addNoteComment, deleteNoteComment, subscribeToNoteComments } from '../repositories/noteCommentsRepo';
import type { NoteComment } from '../types';

function formatarQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Comentários de uma anotação (só texto) — onde o secretário agendado deixa
 * perguntas para melhorar o contexto e sugestões (salvar no Drive/GitHub,
 * virar tarefa). Responda aqui mesmo; ele lê na próxima passada.
 */
export function NoteComments({ uid, noteId }: { uid: string; noteId: string }) {
  const [user] = useSupabaseUser();
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    return subscribeToNoteComments(
      uid,
      noteId,
      (next) => {
        setComments(next);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, [uid, noteId]);

  async function submit() {
    if (!texto.trim()) return;
    setSending(true);
    setError(null);
    try {
      await addNoteComment(uid, noteId, texto, {
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
      await deleteNoteComment(uid, id);
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
