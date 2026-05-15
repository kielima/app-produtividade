import { useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '../lib/firebase';
import {
  defaultFilename,
  downloadJson,
  summarize,
  type ExportPayload,
} from '../lib/exportData';
import { exportAllData } from '../lib/exportFetcher';

export function SettingsView({ uid }: { uid: string }) {
  const [user] = useAuthState(auth);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ExportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const payload = await exportAllData(uid);
      setPreview(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (preview) downloadJson(preview);
  }

  return (
    <section className="settings-view">
      <h2>Configurações</h2>

      <article className="settings-card">
        <h3>Conta</h3>
        <dl className="settings-fields">
          <dt>Email</dt>
          <dd>{user?.email ?? '—'}</dd>
          <dt>UID</dt>
          <dd className="mono">{uid}</dd>
        </dl>
      </article>

      <article className="settings-card">
        <h3>Exportar dados (escape hatch)</h3>
        <p className="muted">
          Baixa todas as suas tarefas, projetos e memória em um único arquivo
          JSON. Útil pra backup local ou pra migrar pra outro stack — sem
          nada preso no Firebase.
        </p>

        <div className="settings-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? 'Lendo do Firestore…' : 'Gerar preview'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleDownload}
            disabled={!preview}
          >
            Baixar JSON
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {preview && (
          <div className="settings-preview">
            <p className="muted">
              Pronto. Conteúdo do <code>{defaultFilename(preview)}</code>:
            </p>
            <ul>
              {Object.entries(summarize(preview)).map(([k, v]) => (
                <li key={k}>
                  <strong>{v}</strong> {k}
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      <article className="settings-card">
        <h3>Sobre</h3>
        <p className="muted">
          PWA <code>app-produtividade</code>. Código em{' '}
          <a
            href="https://github.com/kielima/app-produtividade"
            target="_blank"
            rel="noreferrer"
          >
            github.com/kielima/app-produtividade
          </a>
          . Sistema local em paralelo continua em{' '}
          <code>C:\Users\ttibu\Documents\06_PRODUTIVIDADE\</code>.
        </p>
      </article>
    </section>
  );
}
