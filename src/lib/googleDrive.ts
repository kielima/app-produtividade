import { httpsCallable } from 'firebase/functions';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, functions } from './firebase';

// =========================================================================
// Acesso ao Google Drive (aba Leitura) — mesmo fluxo do Google Calendar:
// authorization-code com refresh token NO SERVIDOR. O usuário consente uma
// vez (GIS code client, popup) com o escopo drive.readonly; a Cloud Function
// `connectDrive` guarda o refresh token; access tokens novos vêm de
// `getDriveAccessToken`. O refresh token nunca chega ao navegador.
//
// Diferente do Calendar, aqui não há scheduler proativo: uma sessão de leitura
// raramente passa de 1h, e qualquer 401 dispara um silent refresh sob demanda.
// =========================================================================

// Leitura E escrita: além de listar/baixar PDFs, a aba Leitura renomeia o
// arquivo no Drive pela tela de metadados. drive.file não serve (os arquivos
// não foram criados pelo app), então é preciso o escopo completo `drive`.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'app-produtividade:gdrive-token';
const HAS_EVER_CONNECTED_KEY = 'app-produtividade:gdrive-connected';

type GetTokenResult =
  | { status: 'ok'; accessToken: string; expiresAt: number }
  | { status: 'needs-connect' }
  | { status: 'needs-reconnect' };
type ConnectResult = { accessToken: string; expiresAt: number };

const callGetToken = httpsCallable<void, GetTokenResult>(functions, 'getDriveAccessToken');
const callConnect = httpsCallable<{ code: string; redirectUri?: string }, ConnectResult>(
  functions,
  'connectDrive',
);
const callDisconnect = httpsCallable<void, { status: string }>(functions, 'disconnectDrive');

type StoredToken = { accessToken: string; expiresAt: number; uid: string };

type GisCodeResponse = {
  code?: string;
  error?: string;
  error_description?: string;
};
type GisCodeClient = {
  callback: (resp: GisCodeResponse) => void;
  error_callback?: (err: { type: string; message?: string }) => void;
  requestCode: () => void;
};
type GisOAuth2 = {
  initCodeClient: (config: {
    client_id: string;
    scope: string;
    ux_mode?: 'popup' | 'redirect';
    hint?: string;
    callback: (resp: GisCodeResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
  }) => GisCodeClient;
};

function readStored(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.uid !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(token: StoredToken): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    // sem espaço / modo privado — segue sem cachear
  }
}

export function clearDriveToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getCachedDriveToken(uid: string): string | null {
  const stored = readStored();
  if (!stored || stored.uid !== uid) return null;
  if (stored.expiresAt - Date.now() < 60_000) return null;
  return stored.accessToken;
}

export function hasDriveAccess(uid: string): boolean {
  return getCachedDriveToken(uid) !== null;
}

export function hasEverConnectedDrive(): boolean {
  try {
    return localStorage.getItem(HAS_EVER_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}

function markEverConnected(): void {
  try {
    localStorage.setItem(HAS_EVER_CONNECTED_KEY, '1');
  } catch {
    // ignore
  }
}

let gisScriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  const oauth2 = (window.google?.accounts as { oauth2?: GisOAuth2 } | undefined)?.oauth2;
  if (oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_URL}"]`,
    );
    const onLoad = () => {
      if ((window.google?.accounts as { oauth2?: GisOAuth2 } | undefined)?.oauth2) resolve();
      else reject(new Error('Google Identity Services não inicializou.'));
    };
    const onError = () => {
      gisScriptPromise = null;
      reject(new Error('Falha ao carregar Google Identity Services.'));
    };
    if (existing) {
      if ((window.google?.accounts as { oauth2?: GisOAuth2 } | undefined)?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', onLoad, { once: true });
    s.addEventListener('error', onError, { once: true });
    document.head.appendChild(s);
  });
  return gisScriptPromise;
}

async function requestAuthCode(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'VITE_GOOGLE_OAUTH_CLIENT_ID não está configurado. Adicione o OAuth 2.0 Web Client ID no .env.local.',
    );
  }
  await loadGisScript();
  const oauth2 = (window.google?.accounts as { oauth2?: GisOAuth2 } | undefined)?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services indisponível.');
  const email = auth.currentUser?.email;
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      ux_mode: 'popup',
      ...(email ? { hint: email } : {}),
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        if (!resp.code) {
          reject(new Error('Google não devolveu authorization code.'));
          return;
        }
        resolve(resp.code);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'Falha ao obter consentimento.'));
      },
    });
    client.requestCode();
  });
}

// No APK (WebView) o popup do Google Identity Services não devolve o resultado,
// então o fluxo de consentimento acima (requestAuthCode) trava. Na plataforma
// nativa usamos o Google Sign-In nativo (@capacitor-firebase/authentication)
// pedindo o escopo do Drive. Ao pedir um escopo extra, o plugin passa pelo
// caminho de "offline access" e devolve DOIS artefatos:
//   - serverAuthCode: mandamos para a Cloud Function `connectDrive`, que troca
//     por um REFRESH TOKEN guardado no servidor. Aí a conexão NÃO expira mais —
//     `getDriveAccessToken` renova o access token sozinho, para sempre.
//   - accessToken: token de Drive imediato (vale ~1h). É o fallback caso a troca
//     do serverAuthCode falhe (ex.: default_web_client_id do google-services.json
//     diferente do client da connectDrive).
// skipNativeAuth (capacitor.config) garante que isto NÃO mexe na sessão de login.
const NATIVE_TOKEN_TTL_MS = 55 * 60 * 1000; // access token do Google dura ~1h

async function nativeGrantDrive(uid: string): Promise<string> {
  const result = await FirebaseAuthentication.signInWithGoogle({
    scopes: [DRIVE_SCOPE],
  });
  const serverAuthCode = result.credential?.serverAuthCode;
  const accessToken = result.credential?.accessToken;

  // Preferência: serverAuthCode → refresh token no servidor (conexão permanente).
  // redirect_uri vazio: é o exigido para o code do Google Sign-In nativo (não é
  // o 'postmessage' do fluxo popup web).
  if (serverAuthCode) {
    try {
      const { data } = await callConnect({ code: serverAuthCode, redirectUri: '' });
      writeStored({ accessToken: data.accessToken, expiresAt: data.expiresAt, uid });
      markEverConnected();
      return data.accessToken;
    } catch (err) {
      console.warn(
        '[gdrive] troca do serverAuthCode falhou; usando access token direto:',
        err,
      );
    }
  }

  // Fallback: access token direto (expira ~1h; renovado por novo sign-in nativo).
  if (accessToken) {
    writeStored({ accessToken, expiresAt: Date.now() + NATIVE_TOKEN_TTL_MS, uid });
    markEverConnected();
    return accessToken;
  }

  throw new Error(
    'O login nativo do Google não devolveu token do Drive (nem serverAuthCode ' +
      'nem accessToken). Verifique se o escopo do Drive foi concedido.',
  );
}

export async function tryRefreshDriveToken(uid: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    // 1) Se a conexão foi feita via serverAuthCode, o servidor tem refresh token:
    //    renova por lá (silencioso e permanente).
    try {
      const { data } = await callGetToken();
      if (data.status === 'ok') {
        writeStored({ accessToken: data.accessToken, expiresAt: data.expiresAt, uid });
        markEverConnected();
        return data.accessToken;
      }
    } catch (err) {
      console.debug('[gdrive] getDriveAccessToken (nativo) falhou:', err);
    }
    // 2) Sem refresh token no servidor (caiu no fallback de access token): não há
    //    refresh silencioso — ensureDriveToken vai chamar grant (novo sign-in).
    return null;
  }
  const backoffs = [0, 1_000, 3_000];
  let lastErr: unknown = null;
  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i] > 0) await sleep(backoffs[i]);
    try {
      const { data } = await callGetToken();
      if (data.status === 'ok') {
        writeStored({ accessToken: data.accessToken, expiresAt: data.expiresAt, uid });
        markEverConnected();
        return data.accessToken;
      }
      return null;
    } catch (err) {
      lastErr = err;
    }
  }
  console.debug('[gdrive] silent refresh falhou:', lastErr);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Interativo: abre o popup de consentimento, manda o code para o backend
// (que guarda o refresh token) e cacheia o access token devolvido.
export async function grantDriveAccess(uid: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    return nativeGrantDrive(uid);
  }
  const code = await requestAuthCode();
  const { data } = await callConnect({ code });
  writeStored({ accessToken: data.accessToken, expiresAt: data.expiresAt, uid });
  markEverConnected();
  return data.accessToken;
}

// Garante um token válido: cache → silent refresh → consentimento interativo.
export async function ensureDriveToken(uid: string): Promise<string> {
  const cached = getCachedDriveToken(uid);
  if (cached) return cached;
  const silent = await tryRefreshDriveToken(uid);
  if (silent) return silent;
  return grantDriveAccess(uid);
}

export async function disconnectDrive(uid: string): Promise<void> {
  clearDriveToken();
  try {
    localStorage.removeItem(HAS_EVER_CONNECTED_KEY);
  } catch {
    // ignore
  }
  void uid;
  await callDisconnect().catch((err) => {
    console.debug('[gdrive] disconnect no servidor falhou:', err);
  });
}

// =========================================================================
// Drive REST API
// =========================================================================

export class DriveAuthError extends Error {
  constructor(message = 'Acesso ao Google Drive expirou ou foi revogado.') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  // Ids das pastas que contêm o arquivo. Normalmente uma só; usamos a primeira
  // para montar o caminho e o link da pasta na estante.
  parents?: string[];
};

type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
  error?: { code?: number; message?: string };
};

// Exportado para ser reaproveitado por outros módulos de integração com o
// Drive (ex.: src/lib/obsidianDrive.ts) sem duplicar o tratamento de 401/403.
export async function driveFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (res.ok) return res;
  if (res.status === 401 || res.status === 403) {
    clearDriveToken();
    throw new DriveAuthError();
  }
  let message = res.statusText;
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    message = json.error?.message ?? message;
  } catch {
    // sem corpo JSON
  }
  throw new Error(`Google Drive API ${res.status}: ${message}`);
}

// Lista TODOS os PDFs da Drive do usuário (paginando). trashed=false ignora a
// lixeira. Ordena por modificação desc.
export async function listDrivePdfs(token: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  const baseParams = {
    q: "mimeType='application/pdf' and trashed=false",
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, parents)',
    pageSize: '200',
    orderBy: 'modifiedTime desc',
    spaces: 'drive',
    // Inclui itens compartilhados e de Drives compartilhados.
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    corpora: 'allDrives',
  };
  do {
    const params = new URLSearchParams(baseParams);
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(
      token,
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    );
    const json = (await res.json()) as DriveListResponse;
    if (json.files) files.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return files;
}

// Link direto para abrir uma pasta no Google Drive na web.
export function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

export type DriveFolderMeta = { id: string; name: string; parents?: string[] };

// Metadados de uma pasta (nome + pasta-mãe). Devolve null quando a pasta não é
// acessível (ex.: raiz de um Drive compartilhado), para a subida do caminho
// parar sem quebrar a sincronização inteira.
async function getDriveFolderMeta(
  token: string,
  folderId: string,
): Promise<DriveFolderMeta | null> {
  const params = new URLSearchParams({
    fields: 'id, name, parents',
    supportsAllDrives: 'true',
  });
  try {
    const res = await driveFetch(
      token,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${params.toString()}`,
    );
    const json = (await res.json()) as DriveFolderMeta;
    return json?.id ? json : null;
  } catch (e) {
    // Um problema de auth deve interromper a sincronização (o chamador reconecta);
    // qualquer outra falha (404/pasta inacessível) apenas encerra o caminho aqui.
    if (e instanceof DriveAuthError) throw e;
    return null;
  }
}

export type ResolvedDriveFolder = { folderId: string; folderPath: string };

// Monta o caminho legível de uma pasta, da raiz até ela própria
// (ex.: "Meu Drive / Artigos / 2024"), subindo pela cadeia de `parents`.
// `metaCache` é compartilhado por toda a sincronização: como muitas PDFs dividem
// as mesmas pastas, cada pasta só é buscada uma vez.
export async function resolveDriveFolderPath(
  token: string,
  folderId: string,
  metaCache: Map<string, DriveFolderMeta | null>,
): Promise<ResolvedDriveFolder> {
  const names: string[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = folderId;
  // Cap de profundidade defensivo contra ciclos ou hierarquias muito fundas.
  for (let depth = 0; currentId && depth < 20; depth++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    let meta = metaCache.get(currentId);
    if (meta === undefined) {
      meta = await getDriveFolderMeta(token, currentId);
      metaCache.set(currentId, meta);
    }
    if (!meta) break;
    names.unshift(meta.name);
    currentId = meta.parents?.[0];
  }
  return { folderId, folderPath: names.join(' / ') };
}

// Baixa os bytes de um arquivo do Drive (alt=media).
export async function downloadDriveFile(
  token: string,
  fileId: string,
): Promise<ArrayBuffer> {
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
  return res.arrayBuffer();
}

// PATCH no nome do arquivo. Devolve o nome efetivo gravado no Drive.
async function patchDriveName(
  token: string,
  fileId: string,
  newName: string,
): Promise<string> {
  const params = new URLSearchParams({
    fields: 'id, name',
    supportsAllDrives: 'true',
  });
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    },
  );
  const json = (await res.json()) as { name?: string };
  return json.name ?? newName;
}

// Renomeia um arquivo no Drive. Se o token em cache só tiver o escopo antigo de
// leitura (usuário conectou antes desta funcionalidade), o PATCH devolve 401/403
// e driveFetch lança DriveAuthError; aí forçamos um novo consentimento
// interativo (já com o escopo de escrita) e tentamos uma vez mais.
export async function renameDriveFile(
  uid: string,
  fileId: string,
  newName: string,
): Promise<string> {
  const token = await ensureDriveToken(uid);
  try {
    return await patchDriveName(token, fileId, newName);
  } catch (e) {
    if (!(e instanceof DriveAuthError)) throw e;
  }
  const fresh = await grantDriveAccess(uid);
  return patchDriveName(fresh, fileId, newName);
}
