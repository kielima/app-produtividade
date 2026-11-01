import { useEffect, useRef, useState } from 'react';
import { inferirTipo } from '../lib/imagens';
import {
  deleteTaskAnexo,
  signedUrlForTaskAnexo,
  subscribeToTaskAnexos,
  uploadTaskAnexo,
} from '../repositories/taskAnexosRepo';
import type { TaskAnexo } from '../types';

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AnexoItem({ anexo, onRemove }: { anexo: TaskAnexo; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const imagem = anexo.tipo.startsWith('image/');

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setErro(false);
    signedUrlForTaskAnexo(anexo.path)
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
    <li className={`task-anexo${imagem ? ' task-anexo-img' : ' task-anexo-arquivo'}`}>
      {imagem ? (
        url ? (
          <a href={url} target="_blank" rel="noreferrer" title={anexo.nome}>
            <img src={url} alt={anexo.nome} />
          </a>
        ) : (
          <span className="task-anexo-loading muted">{erro ? '⚠️' : '…'}</span>
        )
      ) : (
        <a href={url ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!url} title={anexo.nome}>
          📄 <span className="task-anexo-nome">{anexo.nome}</span>{' '}
          <small className="muted">({formatarBytes(anexo.bytes)})</small>
        </a>
      )}
      <button
        type="button"
        className="task-anexo-remover"
        onClick={onRemove}
        aria-label={`remover anexo ${anexo.nome}`}
        title="remover anexo"
      >
        ×
      </button>
    </li>
  );
}

function EnviandoItem({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inferirTipo(file).startsWith('image/')) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <li className={`task-anexo task-anexo-enviando${url ? ' task-anexo-img' : ' task-anexo-arquivo'}`}>
      {url ? <img src={url} alt="" /> : <span>📄 {file.name || 'arquivo'}</span>}
      <span className="task-anexo-enviando-tag">enviando…</span>
    </li>
  );
}

/**
 * Fotos e arquivos (PDF) da tarefa. Envio na hora em que o arquivo é
 * escolhido (ou colado), com prévia enquanto sobe; fotos grandes são
 * reduzidas antes (ver imagens.ts).
 */
export function TaskAnexos({ uid, taskId }: { uid: string; taskId: string }) {
  const [anexos, setAnexos] = useState<TaskAnexo[]>([]);
  const [enviando, setEnviando] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return subscribeToTaskAnexos(uid, taskId, setAnexos, (e) => setError(e.message));
  }, [uid, taskId]);

  async function enviar(files: FileList | File[]) {
    // Copia já: o FileList do <input> é "vivo" e esvazia quando o input é
    // limpo — era exatamente o bug que fazia a foto escolhida sumir.
    const lista = Array.from(files);
    if (inputRef.current) inputRef.current.value = '';
    if (lista.length === 0) return;
    setError(null);
    setEnviando((prev) => [...prev, ...lista]);
    const falharam: string[] = [];
    for (const file of lista) {
      try {
        await uploadTaskAnexo(uid, taskId, file);
      } catch (e) {
        falharam.push(`${file.name || 'arquivo'} — ${e instanceof Error ? e.message : 'erro desconhecido'}`);
      } finally {
        setEnviando((prev) => prev.filter((f) => f !== file));
      }
    }
    if (falharam.length > 0) setError(`Não foi possível anexar:\n${falharam.join('\n')}`);
  }

  async function remover(anexo: TaskAnexo) {
    if (!window.confirm(`Remover o anexo "${anexo.nome}"?`)) return;
    try {
      await deleteTaskAnexo(uid, anexo);
      setAnexos((prev) => prev.filter((a) => a.id !== anexo.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível remover o anexo.');
    }
  }

  return (
    <section
      className="task-detail-section task-anexos"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length > 0) {
          e.preventDefault();
          void enviar(files);
        }
      }}
    >
      <div className="task-detail-section-header">
        <h3>📎 Anexos{anexos.length > 0 ? ` (${anexos.length})` : ''}</h3>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void enviar(e.target.files);
          }}
        />
        <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
          + foto ou arquivo
        </button>
      </div>
      {error && (
        <p className="error" style={{ whiteSpace: 'pre-line' }}>
          {error}
        </p>
      )}
      {anexos.length === 0 && enviando.length === 0 ? (
        <p className="muted">Nenhum anexo.</p>
      ) : (
        <ul className="task-anexos-lista">
          {anexos.map((a) => (
            <AnexoItem key={a.id} anexo={a} onRemove={() => void remover(a)} />
          ))}
          {enviando.map((f, i) => (
            <EnviandoItem key={`${f.name}-${i}`} file={f} />
          ))}
        </ul>
      )}
    </section>
  );
}
