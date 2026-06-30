import { httpsCallable } from 'firebase/functions';
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

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
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

export async function tryRefreshDriveToken(uid: string): Promise<string | null> {
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
};

type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
  error?: { code?: number; message?: string };
};

async function driveFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
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
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
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
