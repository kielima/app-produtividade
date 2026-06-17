import { useRef, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import {
  getDefaultGeminiModel,
  getGeminiApiKey,
  getGeminiModel,
  setGeminiApiKey,
  setGeminiModel,
} from '../lib/aiSubtasks';
import { auth } from '../lib/firebase';
import {
  defaultFilename,
  downloadJson,
  summarize,
  type ExportPayload,
} from '../lib/exportData';
import { exportAllData } from '../lib/exportFetcher';
import {
  ImportParseError,
  parseImportPayload,
  type ImportMode,
} from '../lib/importData';
import { importAllData, type ImportStats } from '../lib/importWriter';
import {
  formatChangelogDate,
  getLatestChangelogEntry,
} from '../lib/changelog';
import { ChangelogDialog } from '../components/ChangelogDialog';

const IMPORT_STAT_LABELS: Record<keyof ImportStats, string> = {
  sections: 'sections',
  tasks: 'tasks',
  projects: 'projects',
  notes: 'notes',
  glicko: 'glicko',
  memoryProjects: 'memoryProjects',
  memoryAutomations: 'memoryAutomations',
  memoryContext: 'memoryContext',
  glossary: 'glossary',
  claude: 'claude',
  deleted: 'docs apagados',
};

export function SettingsView({ uid }: { uid: string }) {
  const [user] = useAuthState(auth);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ExportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [geminiKey, setGeminiKey] = useState(() => getGeminiApiKey());
  const [geminiKeyVisible, setGeminiKeyVisible] = useState(false);
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);
  const [geminiModel, setGeminiModelState] = useState(() => getGeminiModel());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPayload, setImportPayload] = useState<ExportPayload | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportStats | null>(null);

  const [changelogOpen, setChangelogOpen] = useState(false);
  const latestEntry = getLatestChangelogEntry();

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportResult(null);
    setImportPayload(null);
    setImportFileName(file.name);
    try {
      const text = await file.text();
      const payload = parseImportPayload(text);
      setImportPayload(payload);
    } catch (err) {
      const msg =
        err instanceof ImportParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setImportError(msg);
    }
  }

  async function handleImport() {
    if (!importPayload) return;
    if (importMode === 'replace') {
      const ok = window.confirm(
        'Tem certeza? "Substituir tudo" apaga todas as suas tarefas, ' +
          'projetos e memória no Firestore antes de escrever o backup. ' +
          'Não dá pra desfazer.',
      );
      if (!ok) return;
    }
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const stats = await importAllData(uid, importPayload, importMode);
      setImportResult(stats);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function handleSaveGeminiKey() {
    setGeminiApiKey(geminiKey);
    setGeminiModel(geminiModel);
    setGeminiKeySaved(true);
    window.setTimeout(() => setGeminiKeySaved(false), 2000);
  }

  function handleClearGeminiKey() {
    setGeminiApiKey('');
    setGeminiKey('');
    setGeminiKeySaved(false);
  }

  function resetImport() {
    setImportPayload(null);
    setImportFileName(null);
    setImportError(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const importSummary = importPayload ? summarize(importPayload) : null;
  const uidMismatch = importPayload != null && importPayload.uid !== uid;

  return (
    <section className="settings-view">
      <h2>Configurações</h2>

      {latestEntry && (
        <article className="settings-card">
          <h3>Novidades</h3>
          <p className="muted">
            Última atualização de novas funções. Toque na data para ver o log
            completo das features lançadas.
          </p>
          <button
            type="button"
            className="changelog-stamp"
            onClick={() => setChangelogOpen(true)}
            title="Ver log de novas funcionalidades"
          >
            <span className="changelog-stamp-icon" aria-hidden="true">
              🕒
            </span>
            <span className="changelog-stamp-text">
              <span className="changelog-stamp-date">
                {formatChangelogDate(latestEntry.date)}
              </span>
              <span className="changelog-stamp-title">
                {latestEntry.title}
              </span>
            </span>
          </button>
        </article>
      )}

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
        <h3>Inteligência Artificial</h3>
        <p className="muted">
          Configure uma chave do Google Gemini para gerar subtarefas
          automaticamente a partir do título e das notas de uma tarefa. A
          chave fica salva só no localStorage deste navegador — nunca é
          enviada ao Firestore nem ao repositório. Pegue uma chave gratuita
          em{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            aistudio.google.com/apikey
          </a>
          .
        </p>

        <div
          className="settings-actions"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
        >
          <input
            type={geminiKeyVisible ? 'text' : 'password'}
            value={geminiKey}
            onChange={(e) => {
              setGeminiKey(e.target.value);
              setGeminiKeySaved(false);
            }}
            placeholder="AIza…"
            spellCheck={false}
            autoComplete="off"
            style={{
              padding: '0.5rem 0.7rem',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--surface)',
              color: 'var(--fg)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.85rem',
            }}
          />
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            Modelo (padrão: <code>{getDefaultGeminiModel()}</code>)
          </label>
          <input
            type="text"
            value={geminiModel}
            onChange={(e) => {
              setGeminiModelState(e.target.value);
              setGeminiKeySaved(false);
            }}
            placeholder={getDefaultGeminiModel()}
            spellCheck={false}
            autoComplete="off"
            style={{
              padding: '0.5rem 0.7rem',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--surface)',
              color: 'var(--fg)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.85rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSaveGeminiKey}
              disabled={!geminiKey.trim()}
            >
              Salvar chave
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setGeminiKeyVisible((v) => !v)}
            >
              {geminiKeyVisible ? 'Ocultar' : 'Mostrar'}
            </button>
            {getGeminiApiKey() && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleClearGeminiKey}
              >
                Remover
              </button>
            )}
          </div>
          {geminiKeySaved && (
            <p className="muted" style={{ margin: 0 }}>
              ✓ Chave salva neste navegador.
            </p>
          )}
        </div>
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
        <h3>Importar dados</h3>
        <p className="muted">
          Restaura um arquivo JSON exportado por este app. Escolha entre
          mesclar com os dados atuais ou substituir tudo — leia com atenção
          antes de confirmar.
        </p>

        <div className="settings-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importFileName ? 'Trocar arquivo' : 'Selecionar arquivo JSON'}
          </button>
          {importPayload && (
            <button
              type="button"
              className="btn-secondary"
              onClick={resetImport}
              disabled={importing}
            >
              Cancelar
            </button>
          )}
        </div>

        {importFileName && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Arquivo: <code>{importFileName}</code>
          </p>
        )}

        {importError && <p className="error">{importError}</p>}

        {importSummary && (
          <div className="settings-preview">
            <p className="muted">Conteúdo do arquivo:</p>
            <ul>
              {Object.entries(importSummary).map(([k, v]) => (
                <li key={k}>
                  <strong>{v}</strong> {k}
                </li>
              ))}
            </ul>

            {uidMismatch && (
              <p className="muted" style={{ marginTop: '0.5rem' }}>
                Atenção: o UID do arquivo (<code>{importPayload!.uid}</code>)
                não bate com o seu. Os documentos serão escritos no seu
                espaço mesmo assim.
              </p>
            )}

            <fieldset
              style={{
                border: 'none',
                padding: 0,
                margin: '0.7rem 0 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
                fontSize: '0.9rem',
              }}
              disabled={importing}
            >
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />{' '}
                Mesclar — sobrescreve docs com mesmo ID, preserva o resto.
              </label>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />{' '}
                Substituir tudo — apaga as coleções atuais antes de escrever.
              </label>
            </fieldset>

            <div className="settings-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? 'Escrevendo no Firestore…' : 'Importar'}
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <div className="settings-preview">
            <p className="muted">Pronto. Resultado:</p>
            <ul>
              {(Object.keys(IMPORT_STAT_LABELS) as Array<keyof ImportStats>).map(
                (k) => {
                  const value = importResult[k];
                  const display =
                    typeof value === 'boolean' ? (value ? 'sim' : 'não') : value;
                  return (
                    <li key={k}>
                      <strong>{display}</strong> {IMPORT_STAT_LABELS[k]}
                    </li>
                  );
                },
              )}
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
          .
        </p>
      </article>

      {changelogOpen && (
        <ChangelogDialog onClose={() => setChangelogOpen(false)} />
      )}
    </section>
  );
}
