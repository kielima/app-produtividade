import { DriveAuthError, driveFetch, ensureDriveToken, grantDriveAccess } from './googleDrive';
import { isMarkdownFile, type DriveNode } from './obsidianNode';

// =========================================================================
// Acesso ao Google Drive (aba Obsidian) — vault genérico, todos os
// mimeTypes. Diferente de googleDrive.ts (que é focado em PDFs para a aba
// Leitura), aqui listamos e editamos qualquer arquivo dentro de uma pasta,
// incluindo criação de novas notas .md. Reaproveita o mesmo token/escopo
// `drive` completo já concedido — nenhuma nova Cloud Function é necessária.
//
// `DriveNode`/`isMarkdownFile` moraram em obsidianNode.ts (sem import de
// googleDrive.ts) e são só reexportados aqui por conveniência — assim os
// testes de lógica pura (driveFileIcons.test.ts, obsidianTreeState.test.ts)
// podem importar direto de obsidianNode.ts sem arrastar Firebase.
// =========================================================================

export type { DriveNode };
export { isMarkdownFile };

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

function toDriveNode(file: {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
}): DriveNode {
  return {
    id: file.id ?? '',
    name: file.name ?? '',
    mimeType: file.mimeType ?? '',
    modifiedTime: file.modifiedTime,
    size: file.size,
    isFolder: file.mimeType === FOLDER_MIME_TYPE,
  };
}

// Id da pasta raiz do "vault" — a raiz do Meu Drive do usuário. O alias
// especial 'root' do Drive já resolve para o id real, então nem sempre
// precisamos consultar a API para isto, mas expomos como função para manter
// a mesma forma de uso das pastas normais (poder chamar getDriveFolderMeta
// nela depois, se algum dia for preciso o path completo).
export async function getRootFolderId(): Promise<string> {
  return 'root';
}

type DriveListResponse = {
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    modifiedTime?: string;
    size?: string;
  }>;
  nextPageToken?: string;
};

// Lista os filhos IMEDIATOS de uma pasta — todos os mimeTypes (spec item 3),
// pastas primeiro e depois em ordem alfabética (orderBy composto do Drive).
export async function listFolderChildren(
  token: string,
  folderId: string,
): Promise<DriveNode[]> {
  const nodes: DriveNode[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      orderBy: 'folder,name',
      pageSize: '200',
      spaces: 'drive',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      corpora: 'allDrives',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(
      token,
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    );
    const json = (await res.json()) as DriveListResponse;
    if (json.files) nodes.push(...json.files.map(toDriveNode));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return nodes;
}

// Conteúdo bruto de uma nota .md (alt=media assume texto simples/UTF-8).
// Arquivos que não são .md nunca passam por aqui — só ganham ícone/metadados
// no navegador de pastas (spec item 3).
export async function readMarkdownContent(token: string, fileId: string): Promise<string> {
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
  return res.text();
}

// Metadados voláteis usados só na checagem de conflito — chamada leve (sem
// alt=media) antes de cada escrita.
export async function getFileModifiedTime(token: string, fileId: string): Promise<string> {
  const params = new URLSearchParams({ fields: 'modifiedTime', supportsAllDrives: 'true' });
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
  );
  const json = (await res.json()) as { modifiedTime?: string };
  if (!json.modifiedTime) throw new Error('Drive não devolveu modifiedTime.');
  return json.modifiedTime;
}

// PATCH do conteúdo (upload de mídia simples — substitui só o corpo, não os
// metadados). Devolve o modifiedTime novo, que vira a baseline de conflito
// seguinte.
export async function writeMarkdownContent(
  token: string,
  fileId: string,
  content: string,
): Promise<{ modifiedTime: string }> {
  const params = new URLSearchParams({ uploadType: 'media', fields: 'modifiedTime' });
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/markdown' },
      body: content,
    },
  );
  const json = (await res.json()) as { modifiedTime?: string };
  if (!json.modifiedTime) throw new Error('Drive não devolveu modifiedTime após salvar.');
  return { modifiedTime: json.modifiedTime };
}

// Cria uma nova nota .md dentro de uma pasta (usado tanto para "nova nota"
// quanto para a opção "manter as duas" do diálogo de conflito).
export async function createMarkdownFile(
  token: string,
  folderId: string,
  name: string,
): Promise<DriveNode> {
  const metadataRes = await driveFetch(
    token,
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,size',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [folderId], mimeType: 'text/markdown' }),
    },
  );
  const created = (await metadataRes.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
    modifiedTime?: string;
    size?: string;
  };
  if (!created.id) throw new Error('Drive não devolveu id do arquivo criado.');
  return toDriveNode(created);
}

// Garante um token válido reaproveitando o mesmo fluxo de conexão da aba
// Leitura (cache → silent refresh → consentimento interativo). Exposto aqui
// para os chamadores de src/views/ObsidianView.tsx não precisarem importar
// de googleDrive.ts diretamente.
export { ensureDriveToken, grantDriveAccess, DriveAuthError };
