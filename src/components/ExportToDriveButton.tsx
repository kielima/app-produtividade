import { useState } from 'react';
import { DriveFolderPickerDialog } from './DriveFolderPickerDialog';
import {
  createMarkdownFile,
  DriveAuthError,
  ensureDriveToken,
  grantDriveAccess,
  writeMarkdownContent,
} from '../lib/grafosDrive';

function sanitizeFileName(title: string): string {
  const cleaned = title.replace(/[\\/]/g, '-').trim();
  return cleaned || 'Sem título';
}

// Botão "salvar no Google Drive": exporta uma tarefa/anotação como arquivo
// .md — nome do arquivo é o título, conteúdo é a nota. Reaproveita o mesmo
// token/escopo do Drive já usado pelas abas Leitura/Grafos (nenhum consentimento
// novo é pedido se o usuário já conectou antes).
export function ExportToDriveButton({
  uid,
  title,
  content,
  ariaLabel = 'salvar no Google Drive',
}: {
  uid: string;
  title: string;
  content: string;
  ariaLabel?: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleClick() {
    setConnecting(true);
    try {
      const t = await ensureDriveToken(uid);
      setToken(t);
      setPickerOpen(true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Falha ao conectar ao Google Drive.');
    } finally {
      setConnecting(false);
    }
  }

  // Cria o .md e grava o conteúdo; se o token cacheado só tiver o escopo
  // antigo (ou tiver expirado no meio do caminho), força um novo
  // consentimento e tenta mais uma vez — mesmo padrão de withAuthRetry em
  // googleDrive.ts, que não dá pra reaproveitar direto (fica dentro do
  // estado do componente, não é uma função solta).
  async function saveToFolder(activeToken: string, folderId: string, allowRetry: boolean): Promise<void> {
    const fileName = `${sanitizeFileName(title)}.md`;
    try {
      const created = await createMarkdownFile(activeToken, folderId, fileName);
      await writeMarkdownContent(activeToken, created.id, content ?? '');
    } catch (e) {
      if (allowRetry && e instanceof DriveAuthError) {
        const fresh = await grantDriveAccess(uid);
        setToken(fresh);
        await saveToFolder(fresh, folderId, false);
        return;
      }
      throw e;
    }
  }

  async function handleSelectFolder(folderId: string) {
    if (!token) return;
    setSaving(true);
    try {
      await saveToFolder(token, folderId, true);
      setPickerOpen(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Falha ao salvar no Google Drive.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`copy-markdown-btn${saved ? ' is-copied' : ''}`}
        onClick={handleClick}
        aria-label={ariaLabel}
        title={saved ? 'salvo no Drive!' : 'salvar no Google Drive'}
        disabled={connecting}
      >
        {saved ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20 6L9 17l-5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 15V4M12 4l-3.5 3.5M12 4l3.5 3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      {pickerOpen && token && (
        <DriveFolderPickerDialog
          token={token}
          title={`Salvar "${sanitizeFileName(title)}.md"`}
          busy={saving}
          onCancel={() => setPickerOpen(false)}
          onSelect={handleSelectFolder}
        />
      )}
    </>
  );
}
