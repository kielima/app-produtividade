import { DriveAuthError, driveFetch, ensureDriveToken, grantDriveAccess } from './googleDrive';
import { isMarkdownFile, type DriveNode } from './grafosNode';

// =========================================================================
// Acesso ao Google Drive (aba Grafos) — vault genérico, todos os
// mimeTypes. Diferente de googleDrive.ts (que é focado em PDFs para a aba
// Leitura), aqui listamos e editamos qualquer arquivo dentro de uma pasta,
// incluindo criação de novas notas .md. Reaproveita o mesmo token/escopo
// `drive` completo já concedido — nenhuma nova Cloud Function é necessária.
//
// `DriveNode`/`isMarkdownFile` moraram em grafosNode.ts (sem import de
// googleDrive.ts) e são só reexportados aqui por conveniência — assim os
// testes de lógica pura (driveFileIcons.test.ts, grafosTreeState.test.ts)
// podem importar direto de grafosNode.ts sem arrastar Firebase.
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

// Helper de paginação/parsing compartilhado por toda consulta `files.list` —
// listagem de pasta (Fase 1) e as duas buscas abaixo (Fase 2) reaproveitam o
// mesmo "mecanismo" de chamar a API do Drive em tempo real, só variando a
// cláusula `q` e, opcionalmente, limitando resultados (autocomplete não
// precisa da lista inteira, a correção de links no rename precisa).
async function runDriveQuery(
  token: string,
  q: string,
  opts: { orderBy?: string; maxResults?: number } = {},
): Promise<DriveNode[]> {
  const nodes: DriveNode[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      pageSize: '200',
      spaces: 'drive',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      corpora: 'allDrives',
    });
    if (opts.orderBy) params.set('orderBy', opts.orderBy);
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(
      token,
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    );
    const json = (await res.json()) as DriveListResponse;
    if (json.files) nodes.push(...json.files.map(toDriveNode));
    pageToken = json.nextPageToken;
  } while (pageToken && (!opts.maxResults || nodes.length < opts.maxResults));
  return opts.maxResults ? nodes.slice(0, opts.maxResults) : nodes;
}

// Aspas simples e barras invertidas precisam ser escapadas dentro de um
// literal de string da sintaxe de busca do Drive (`q=...`).
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Lista os filhos IMEDIATOS de uma pasta — todos os mimeTypes (spec item 3),
// pastas primeiro e depois em ordem alfabética (orderBy composto do Drive).
export async function listFolderChildren(
  token: string,
  folderId: string,
): Promise<DriveNode[]> {
  return runDriveQuery(token, `'${folderId}' in parents and trashed=false`, {
    orderBy: 'folder,name',
  });
}

// A seção "Computadores" do Drive (backup do Google Drive para desktop) não
// aparece navegando a partir da raiz (`'root' in parents` nunca a retorna) —
// uma primeira tentativa de contornar isso buscando pastas sem `parents` foi
// testada e não resolveu (a suposição de que essas pastas viriam com
// `parents` vazio na resposta da API se mostrou errada). Correção mais
// simples e confiável: deixar o usuário marcar a pasta como favorita
// (⭐ starred) no próprio Drive — `starred=true` é um campo plano da API,
// independente de hierarquia, então funciona não importa onde a pasta viva.
// Vale tanto para pastas quanto para arquivos/notas individuais.
export async function listStarredItems(token: string): Promise<DriveNode[]> {
  return runDriveQuery(token, 'starred = true and trashed = false', { orderBy: 'folder,name' });
}

// Busca por NOME em tempo real no Drive inteiro (spec item 5) — usada pelo
// autocomplete de `[[` e pela resolução de clique num link ainda não
// carregado nesta sessão. Limitada a poucos resultados: é uma busca
// interativa, não precisa (nem deveria, por latência) trazer tudo.
const AUTOCOMPLETE_MAX_RESULTS = 20;

export async function searchFilesByName(token: string, query: string): Promise<DriveNode[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = `name contains '${escapeDriveQueryValue(trimmed)}' and trashed=false`;
  return runDriveQuery(token, q, { orderBy: 'name', maxResults: AUTOCOMPLETE_MAX_RESULTS });
}

// Busca por CONTEÚDO no Drive inteiro (spec item 6/7). A correção de links ao
// renomear uma nota precisa de TODOS os arquivos que citam o nome antigo (sem
// `maxResults`); já a busca geral da Fase 4 passa um limite, pra não paginar
// o Drive inteiro a cada tecla digitada na caixa de busca.
export async function searchFilesContainingText(
  token: string,
  text: string,
  maxResults?: number,
): Promise<DriveNode[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const q = `fullText contains '${escapeDriveQueryValue(trimmed)}' and trashed=false`;
  return runDriveQuery(token, q, maxResults != null ? { maxResults } : undefined);
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

// Conteúdo binário bruto (imagens, PDFs) pro preview inline no grafo — mesmo
// endpoint de `readMarkdownContent`, só sem assumir texto.
export async function readBinaryContent(token: string, fileId: string): Promise<ArrayBuffer> {
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
  return res.arrayBuffer();
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
// para os chamadores de src/views/GrafosView.tsx não precisarem importar
// de googleDrive.ts diretamente.
export { ensureDriveToken, grantDriveAccess, DriveAuthError };
