import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addTaskComment,
  deleteTaskComment,
  deleteTaskCommentAnexo,
  signedUrlForAnexo,
  subscribeToTaskComments,
  uploadTaskCommentAnexo,
} from '../repositories/taskCommentsRepo';
import { useSupabaseUser } from '../lib/useSession';
import { inferirTipo } from '../lib/imagens';
import { useResources, resourcePhotoSrc } from '../lib/resources';
import type { TaskComment, TaskCommentAnexo } from '../types';

const FORMATO_DATA: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };

function formatarQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', FORMATO_DATA);
}

function nomeDoAutor(c: TaskComment): string {
  return c.autorNome || c.autorEmail || 'alguém';
}

function inicialDoAutor(c: TaskComment): string {
  const nome = nomeDoAutor(c);
  return nome.charAt(0).toUpperCase();
}

export function AutorAvatar({ comment }: { comment: Pick<TaskComment, 'autorNome' | 'autorEmail'> }) {
  const { resources } = useResources();
  const nome = (comment.autorNome ?? '').trim().toLowerCase();
  const recurso = nome ? resources.find((r) => r.nome.trim().toLowerCase() === nome) : undefined;
  const src = resourcePhotoSrc(recurso?.foto);
  return (
    <span className="task-comment-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" /> : inicialDoAutor(comment as TaskComment)}
    </span>
  );
}

function ehImagem(tipo: string): boolean {
  return tipo.startsWith('image/');
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Anexo({ anexo, onRemove }: { anexo: TaskCommentAnexo; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setErro(false);
    signedUrlForAnexo(anexo.path)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setErro(true);
      });
    return () => {
      cancelled = true;
    };
  }, [anexo.path]);

  return (
    <span className="task-comment-anexo">
      {ehImagem(anexo.tipo) ? (
        url ? (
          <a href={url} target="_blank" rel="noreferrer" title={anexo.nome}>
            <img src={url} alt={anexo.nome} className="task-comment-anexo-img" />
          </a>
        ) : (
          <span className="task-comment-anexo-loading muted">{erro ? '⚠️' : '…'}</span>
        )
      ) : (
        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="task-comment-anexo-arquivo"
          aria-disabled={!url}
        >
          📎 {anexo.nome} <small className="muted">({formatarBytes(anexo.bytes)})</small>
        </a>
      )}
      {onRemove && (
        <button
          type="button"
          className="task-comment-anexo-remover"
          onClick={onRemove}
          aria-label={`remover anexo ${anexo.nome}`}
          title="remover anexo"
        >
          ×
        </button>
      )}
    </span>
  );
}

function PendingPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inferirTipo(file).startsWith('image/')) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" className="task-comment-pendente-thumb" /> : <span aria-hidden="true">📎</span>;
}

/**
 * Comentários de uma tarefa — igual à aba Tarefas do painel da Sudeste
 * (kielima.com/sdt/tarefas): texto + autor + quando, com foto/PDF anexado.
 * RLS isola por `user_id` como o resto do app; `autorNome`/`autorEmail` são
 * só exibição — hoje sempre a mesma conta, mas já valem para quando a tarefa
 * for delegada a outra pessoa.
 */
export function TaskComments({ uid, taskId }: { uid: string; taskId: string }) {
  const [user] = useSupabaseUser();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToTaskComments(
      uid,
      (next) => {
        setComments(next);
        setLoading(false);
      },
      { taskId, onError: (e) => setError(e.message) },
    );
    return unsub;
  }, [uid, taskId]);

  const autor = useMemo(
    () => ({ email: user?.email ?? null, nome: user?.displayName ?? null }),
    [user?.email, user?.displayName],
  );

  function addFiles(files: FileList | File[]) {
    // Copia para um array AGORA: o FileList do <input> é "vivo" e fica vazio
    // assim que o input é limpo (`e.target.value = ''` logo abaixo). Antes,
    // a cópia acontecia dentro do updater do setState — que roda depois da
    // limpeza — e a foto escolhida simplesmente sumia, sem erro nenhum.
    const lista = Array.from(files);
    if (lista.length === 0) return;
    setError(null);
    setPendingFiles((prev) => [...prev, ...lista]);
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) addFiles(files);
  }

  async function submit() {
    const corpo = texto.trim();
    if (!corpo && pendingFiles.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const comentario = await addTaskComment(uid, taskId, corpo || '📎', autor);
      const falharam: string[] = [];
      for (const file of pendingFiles) {
        try {
          await uploadTaskCommentAnexo(uid, comentario.id, file);
        } catch (e) {
          const motivo = e instanceof Error ? e.message : 'erro desconhecido';
          falharam.push(`${file.name || 'arquivo'} — ${motivo}`);
        }
      }
      setTexto('');
      setPendingFiles([]);
      if (falharam.length > 0) {
        setError(`Comentário salvo, mas estes anexos falharam:\n${falharam.join('\n')}`);
      }
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

  async function removerAnexo(anexo: TaskCommentAnexo) {
    if (!window.confirm('Apagar este anexo?')) return;
    try {
      await deleteTaskCommentAnexo(uid, anexo);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível apagar o anexo.');
    }
  }

  return (
    <section className="task-detail-section task-comments">
      <div className="task-detail-section-header">
        <h3>Comentários{comments.length > 0 ? ` (${comments.length})` : ''}</h3>
      </div>

      {error && <p className="error" style={{ whiteSpace: 'pre-line' }}>{error}</p>}

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
                {c.anexos.length > 0 && (
                  <div className="task-comment-anexos">
                    {c.anexos.map((a) => (
                      <Anexo key={a.id} anexo={a} onRemove={() => removerAnexo(a)} />
                    ))}
                  </div>
                )}
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
          onPaste={onPaste}
          placeholder="Escreva um comentário… (dá para colar uma imagem)"
          rows={2}
          disabled={sending}
        />
        {pendingFiles.length > 0 && (
          <div className="task-comment-pendentes">
            {pendingFiles.map((f, i) => (
              <span key={`${f.name}-${i}`} className="task-comment-pendente-chip">
                <PendingPreview file={f} />
                {f.name || 'arquivo'}
                <button
                  type="button"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={`remover ${f.name} antes de enviar`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="task-comment-compositor-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            📎 anexar
          </button>
          <button
            type="button"
            className="btn-secondary task-comment-enviar"
            disabled={sending || (!texto.trim() && pendingFiles.length === 0)}
            onClick={submit}
          >
            {sending ? 'enviando…' : 'comentar'}
          </button>
        </div>
      </div>
    </section>
  );
}
