import { useRef, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import {
  getDefaultGeminiModel,
  getGeminiModel,
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
import {
  buildIdentificavel,
  podeInstalarApk,
  servicoDisponivel,
  verificarAtualizacao,
  instalarAtualizacao,
  type InfoAtualizacao,
} from '../lib/atualizacao';

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

  const [geminiModel, setGeminiModelState] = useState(() => getGeminiModel());
  const [geminiModelSaved, setGeminiModelSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPayload, setImportPayload] = useState<ExportPayload | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportStats | null>(null);

  const [changelogOpen, setChangelogOpen] = useState(false);
  const latestEntry = getLatestChangelogEntry();

  // Verificação de atualização (compara o commit da build com a última build
  // publicada no Firestore). No APK, baixa e instala direto; no navegador, o
  // service worker atualiza sozinho ao recarregar.
  const [verificandoUpd, setVerificandoUpd] = useState(false);
  const [instalandoUpd, setInstalandoUpd] = useState(false);
  const [infoUpd, setInfoUpd] = useState<InfoAtualizacao | null>(null);
  const [statusUpd, setStatusUpd] = useState<string | null>(null);
  const [erroUpd, setErroUpd] = useState<string | null>(null);

  async function verificarUpd() {
    setErroUpd(null);
    setStatusUpd(null);
    setInfoUpd(null);
    setVerificandoUpd(true);
    try {
      const info = await verificarAtualizacao();
      setInfoUpd(info);
      if (!buildIdentificavel()) {
        setStatusUpd(
          'Build de desenvolvimento — não dá para comparar com a última versão.',
        );
      } else if (info.disponivel && podeInstalarApk() && info.urlApk) {
        // No APK, já baixa e instala direto ao encontrar versão nova.
        await instalarUpd(info.urlApk);
      } else if (info.disponivel) {
        setStatusUpd(null);
      } else {
        setStatusUpd('Você já está na última versão.');
      }
    } catch (e) {
      setErroUpd(
        e instanceof Error
          ? `Não foi possível verificar: ${e.message}`
          : 'Não foi possível verificar a atualização.',
      );
    } finally {
      setVerificandoUpd(false);
    }
  }

  async function instalarUpd(url: string) {
    setErroUpd(null);
    setStatusUpd(null);
    setInstalandoUpd(true);
    try {
      await instalarAtualizacao(url);
      setStatusUpd(
        'Baixando a atualização… acompanhe na barra de notificações. O instalador abrirá ao terminar.',
      );
    } catch (e) {
      setErroUpd(
        e instanceof Error
          ? `Falha ao baixar/instalar: ${e.message}`
          : 'Falha ao baixar/instalar a atualização.',
      );
    } finally {
      setInstalandoUpd(false);
    }
  }

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

  function handleSaveGeminiModel() {
    setGeminiModel(geminiModel);
    setGeminiModelSaved(true);
    window.setTimeout(() => setGeminiModelSaved(false), 2000);
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
          Recursos de IA (subtarefas, transcrição de imagem compartilhada,
          classificação de itens da Leitura) usam o Google Gemini. A chave de
          API fica guardada no Secret Manager do Firebase — não precisa
          configurar nada aqui, e ela nunca chega ao navegador. Só o modelo é
          ajustável por dispositivo.
        </p>

        <div
          className="settings-actions"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
        >
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            Modelo (padrão: <code>{getDefaultGeminiModel()}</code>)
          </label>
          <input
            type="text"
            value={geminiModel}
            onChange={(e) => {
              setGeminiModelState(e.target.value);
              setGeminiModelSaved(false);
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
              onClick={handleSaveGeminiModel}
            >
              Salvar modelo
            </button>
          </div>
          {geminiModelSaved && (
            <p className="muted" style={{ margin: 0 }}>
              ✓ Modelo salvo neste navegador.
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
        <h3>Atualização</h3>
        <p className="muted">
          Verifica se há uma build mais recente publicada.
          {podeInstalarApk()
            ? ' Se houver, baixa o APK e abre o instalador direto.'
            : ' No navegador, o app se atualiza sozinho ao recarregar; aqui você só confere a versão publicada.'}
        </p>

        {servicoDisponivel() ? (
          <div className="settings-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={verificarUpd}
              disabled={verificandoUpd || instalandoUpd}
            >
              {verificandoUpd
                ? 'Verificando…'
                : instalandoUpd
                  ? 'Baixando…'
                  : 'Verificar atualização'}
            </button>
          </div>
        ) : (
          <p className="muted">
            Verificação de atualização indisponível nesta build (sem Firebase
            configurado).
          </p>
        )}

        {infoUpd?.disponivel && buildIdentificavel() && (
          <div className="settings-preview">
            <p className="muted">
              Atualização disponível
              {infoUpd.commitRemoto && ` · versão ${infoUpd.commitRemoto}`}
              {infoUpd.publicadoEm &&
                ` · ${infoUpd.publicadoEm.toLocaleDateString('pt-BR')}`}
              .
            </p>
            {podeInstalarApk() && infoUpd.urlApk ? (
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void instalarUpd(infoUpd.urlApk!)}
                  disabled={instalandoUpd}
                >
                  {instalandoUpd ? 'Baixando…' : 'Baixar e instalar'}
                </button>
              </div>
            ) : (
              <p className="muted">Recarregue a página para aplicar a nova versão.</p>
            )}
          </div>
        )}

        {statusUpd && <p className="muted">{statusUpd}</p>}
        {erroUpd && <p className="error">{erroUpd}</p>}

        <p className="muted" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
          build {__APP_BUILD__}
        </p>
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
