import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';

// =========================================================================
// Aquisição de token — fluxo authorization-code com refresh token NO SERVIDOR.
//
// O usuário consente UMA vez (GIS code client, popup). O code vai para a
// Cloud Function `connectCalendar`, que guarda o refresh token no servidor.
// A partir daí, todo access token novo vem da Function `getCalendarAccessToken`
// (sem iframe, sem cookies de terceiros) — então a renovação é confiável e não
// força popups recorrentes. O refresh token nunca chega ao navegador.
// =========================================================================

// Escopo de leitura/escrita de eventos. Cobre os dois usos da aba Contagem
// Regressiva: listar próximos eventos e criar novos via FAB.
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'app-produtividade:gcal-token';
const HAS_EVER_CONNECTED_KEY = 'app-produtividade:gcal-connected';
const EVENTS_CACHE_KEY = 'app-produtividade:gcal-events';

// -------------------------------------------------------------------------
// Callables do backend
// -------------------------------------------------------------------------
type GetTokenResult =
  | { status: 'ok'; accessToken: string; expiresAt: number }
  | { status: 'needs-connect' }
  | { status: 'needs-reconnect' };
type ConnectResult = { accessToken: string; expiresAt: number };

const callGetToken = httpsCallable<void, GetTokenResult>(
  functions,
  'getCalendarAccessToken',
);
const callConnect = httpsCallable<{ code: string; redirectUri?: string }, ConnectResult>(
  functions,
  'connectCalendar',
);
const callDisconnect = httpsCallable<void, { status: string }>(
  functions,
  'disconnectCalendar',
);

// Disparar o silent refresh aos ~30min de um token de 1h (metade do TTL real),
// bem antes da expiração efetiva, dá margem larga para retries em caso de
// blip de rede e mantém a sessão Calendar viva indefinidamente enquanto o
// usuário continuar logado no Google no navegador.
const REFRESH_SAFETY_MS = 30 * 60 * 1000;
// Se um refresh agendado falhar, reagenda este tempo depois para tentar de
// novo, em vez de desistir e esperar até o token expirar de fato.
const REFRESH_RETRY_AFTER_FAIL_MS = 5 * 60 * 1000;
// Janela em que `visibilitychange` / `online` consideram que vale a pena
// disparar um refresh imediato (token quase no fim).
const PROACTIVE_REFRESH_WINDOW_MS = 5 * 60 * 1000;

type StoredToken = {
  accessToken: string;
  expiresAt: number;
  uid: string;
};

type GisCodeResponse = {
  code?: string;
  scope?: string;
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

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GisOAuth2;
      };
    };
  }
}

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
  // Reagenda o próximo refresh baseado na nova expiração. Se o scheduler
  // ainda não foi iniciado, não faz nada — quem inicia chama
  // `startCalendarTokenScheduler` explicitamente.
  if (schedulerUid === token.uid) {
    scheduleNextRefresh();
  }
}

// Apenas invalida o token cacheado. Mantém scheduler e flag de "já conectou"
// — usado quando a API responde 401 e queremos forçar um refresh em vez de
// desconectar de fato.
export function clearCalendarToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

// Disconnect explícito do usuário: limpa cache + flag de "já conectou" e
// para o scheduler. Após isso, o app só refaz a conexão por gesto explícito
// do usuário ("Conectar Google Calendar").
export function disconnectCalendar(): void {
  clearCalendarToken();
  stopCalendarTokenScheduler();
  try {
    localStorage.removeItem(HAS_EVER_CONNECTED_KEY);
    localStorage.removeItem(EVENTS_CACHE_KEY);
  } catch {
    // ignore
  }
  // Revoga no Google e apaga o refresh token do servidor. Fire-and-forget:
  // a UX local já foi limpa; se a chamada falhar, o estado local some do mesmo
  // jeito e a próxima conexão refaz o consentimento.
  void callDisconnect().catch((err) => {
    console.debug('[gcal] disconnect no servidor falhou:', err);
  });
}

export function getCachedCalendarToken(uid: string): string | null {
  const stored = readStored();
  if (!stored) return null;
  if (stored.uid !== uid) return null;
  // Margem de 60s para evitar usar token quase expirando.
  if (stored.expiresAt - Date.now() < 60_000) return null;
  return stored.accessToken;
}

export function hasCalendarAccess(uid: string): boolean {
  return getCachedCalendarToken(uid) !== null;
}

// Flag persistente: "este usuário já consentiu acesso ao Google Calendar pelo
// menos uma vez neste navegador". Usado para decidir entre mostrar a tela
// "Conectar" (primeiro acesso) ou apenas um banner discreto e seguir tentando
// silent refresh em background (reconexão durante uso).
export function hasEverConnectedCalendar(): boolean {
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
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_URL}"]`,
    );
    const onLoad = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error('Google Identity Services não inicializou.'));
    };
    const onError = () => {
      gisScriptPromise = null;
      reject(new Error('Falha ao carregar Google Identity Services.'));
    };
    if (existing) {
      // Script já foi inserido (pelo index.html) — pode estar carregando ainda.
      if (window.google?.accounts?.oauth2) {
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

// Abre o popup de consentimento (GIS code client) e devolve o authorization
// code. Em ux_mode 'popup' o code é trocado no servidor com
// redirect_uri='postmessage'. Como o fluxo é authorization-code, o Google
// emite um refresh token no primeiro consentimento (e a cada novo consentimento
// após uma revogação) — que a Function guarda no servidor.
async function requestAuthCode(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'VITE_GOOGLE_OAUTH_CLIENT_ID não está configurado. Adicione o OAuth 2.0 Web Client ID no .env.local.',
    );
  }
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google Identity Services indisponível.');
  }
  const email = auth.currentUser?.email;
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: CALENDAR_SCOPE,
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

// Renovação silenciosa: pede um access token novo ao backend, que o emite a
// partir do refresh token guardado no servidor. Sem iframe e sem cookies de
// terceiros, então não depende da sessão Google do navegador.
//
// Faz até 3 tentativas com backoff para tolerar blips de rede antes de desistir.
// `needs-connect`/`needs-reconnect` são respostas definitivas (não adianta
// repetir) e retornam null.
export async function tryRefreshCalendarToken(
  uid: string,
): Promise<string | null> {
  const backoffs = [0, 1_000, 3_000];
  let lastErr: unknown = null;
  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i] > 0) await sleep(backoffs[i]);
    try {
      const { data } = await callGetToken();
      if (data.status === 'ok') {
        writeStored({ accessToken: data.accessToken, expiresAt: data.expiresAt, uid });
        // Sucesso reaquece a flag — cobre o caso de outro dispositivo já ter
        // conectado (refresh token vive no servidor, por usuário).
        markEverConnected();
        return data.accessToken;
      }
      // Definitivo: backend não tem (ou perdeu) o refresh token. Não há o que
      // renovar silenciosamente — o usuário precisa conectar/reconectar.
      return null;
    } catch (err) {
      lastErr = err;
    }
  }
  console.debug('[gcal] silent refresh falhou:', lastErr);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Interativo: abre o popup de consentimento uma vez, manda o code para o
// backend (que guarda o refresh token) e cacheia o access token devolvido.
export async function grantCalendarAccess(uid: string): Promise<string> {
  const code = await requestAuthCode();
  const { data } = await callConnect({ code });
  writeStored({ accessToken: data.accessToken, expiresAt: data.expiresAt, uid });
  markEverConnected();
  startCalendarTokenScheduler(uid);
  return data.accessToken;
}

export async function ensureCalendarToken(uid: string): Promise<string> {
  const cached = getCachedCalendarToken(uid);
  if (cached) return cached;
  const silent = await tryRefreshCalendarToken(uid);
  if (silent) {
    startCalendarTokenScheduler(uid);
    return silent;
  }
  return grantCalendarAccess(uid);
}

// =========================================================================
// Scheduler proativo de refresh
// =========================================================================
//
// Singleton por aba. Agenda um silent refresh ~30min antes da expiração e se
// reagenda a cada sucesso. Em falha, reagenda em 5min — a sessão Google pode
// estar temporariamente indisponível (rede, popup blocker no iframe, etc.) e
// uma nova tentativa breve costuma resolver. Listeners de `visibilitychange`
// e `online` disparam refresh imediato quando a aba volta ao foco ou a rede
// volta, se o token está dentro da janela de risco.

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerUid: string | null = null;
let visibilityListenerAttached = false;
let onlineListenerAttached = false;
let inFlightRefresh: Promise<string | null> | null = null;

function clearScheduledRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function nextRefreshDelay(): number {
  const stored = readStored();
  if (!stored) return REFRESH_RETRY_AFTER_FAIL_MS;
  const timeUntilExpiry = stored.expiresAt - Date.now();
  // Se ainda falta mais de 30min, dorme até "expiry - 30min". Caso contrário
  // (token já dentro da janela de risco), refresca quase imediatamente.
  return Math.max(1_000, timeUntilExpiry - REFRESH_SAFETY_MS);
}

async function runScheduledRefresh(): Promise<void> {
  const uid = schedulerUid;
  if (!uid) return;
  // Coalesce: se já há um refresh em andamento (ex.: outro caller chamou
  // tryRefresh ao mesmo tempo), espera o resultado dele.
  const token = await (inFlightRefresh ?? tryRefreshCalendarToken(uid));
  if (schedulerUid !== uid) return; // scheduler trocou de uid no meio
  if (token) {
    scheduleNextRefresh();
  } else {
    // Falhou: tenta de novo em alguns minutos. Não limpa cache nem flag —
    // pode ser blip temporário.
    refreshTimer = setTimeout(runScheduledRefresh, REFRESH_RETRY_AFTER_FAIL_MS);
  }
}

function scheduleNextRefresh(): void {
  clearScheduledRefresh();
  if (!schedulerUid) return;
  refreshTimer = setTimeout(runScheduledRefresh, nextRefreshDelay());
}

function maybeRefreshOnFocus(): void {
  if (!schedulerUid) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return;
  }
  const stored = readStored();
  if (!stored) {
    // Sem token cacheado: tenta refrescar imediatamente (pode ter expirado
    // enquanto a aba estava em background há horas).
    void runScheduledRefresh();
    return;
  }
  const timeUntilExpiry = stored.expiresAt - Date.now();
  if (timeUntilExpiry < PROACTIVE_REFRESH_WINDOW_MS) {
    void runScheduledRefresh();
  }
}

function attachWindowListeners(): void {
  if (typeof window === 'undefined') return;
  if (!visibilityListenerAttached) {
    document.addEventListener('visibilitychange', maybeRefreshOnFocus);
    visibilityListenerAttached = true;
  }
  if (!onlineListenerAttached) {
    window.addEventListener('online', maybeRefreshOnFocus);
    onlineListenerAttached = true;
  }
}

// Inicia (ou reconfigura) o scheduler para um uid. Idempotente: se já está
// rodando para o mesmo uid, apenas reagenda baseado no token corrente.
export function startCalendarTokenScheduler(uid: string): void {
  schedulerUid = uid;
  attachWindowListeners();
  const stored = readStored();
  if (stored && stored.uid === uid) {
    scheduleNextRefresh();
  } else if (hasEverConnectedCalendar()) {
    // Sem token cacheado mas o usuário já conectou antes: dispara um refresh
    // imediato em background. Se conseguir, ótimo; se não, o `runScheduledRefresh`
    // já reagenda em 5min.
    refreshTimer = setTimeout(runScheduledRefresh, 0);
  }
}

export function stopCalendarTokenScheduler(): void {
  clearScheduledRefresh();
  schedulerUid = null;
}

// Wrapper que mantém um único refresh em flight por vez. Útil para os pontos
// que querem "pegue um token agora se possível" sem disparar várias chamadas
// concorrentes ao GIS.
export function refreshCalendarTokenOnce(uid: string): Promise<string | null> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = tryRefreshCalendarToken(uid).finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

export type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  // ISO date "YYYY-MM-DD" para eventos all-day; ISO datetime para eventos com horário.
  startDate: string;
  startIsAllDay: boolean;
  recurringEventId?: string;
};

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
};

function toCalendarEvent(g: GoogleEvent): CalendarEvent | null {
  if (!g.id || !g.start) return null;
  if (g.status === 'cancelled') return null;
  const startDate = g.start.date ?? g.start.dateTime;
  if (!startDate) return null;
  return {
    id: g.id,
    summary: g.summary ?? '(sem título)',
    description: g.description,
    location: g.location,
    htmlLink: g.htmlLink,
    startDate,
    startIsAllDay: Boolean(g.start.date),
    recurringEventId: g.recurringEventId,
  };
}

export class CalendarAuthError extends Error {
  constructor(message = 'Acesso ao Google Calendar expirou ou foi revogado.') {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

type GoogleApiError = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

async function parseGoogleError(res: Response): Promise<{
  message: string;
  reason: string | null;
}> {
  try {
    const json = (await res.clone().json()) as GoogleApiError;
    const msg = json.error?.message ?? '';
    const reason = json.error?.errors?.[0]?.reason ?? json.error?.status ?? null;
    return { message: msg, reason };
  } catch {
    try {
      const text = await res.text();
      return { message: text, reason: null };
    } catch {
      return { message: res.statusText, reason: null };
    }
  }
}

async function callCalendarApi(
  uid: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.ok) {
    void uid;
    return res;
  }

  const { message, reason } = await parseGoogleError(res);

  // 401 sempre é token inválido/expirado. 403 com reason "insufficientPermissions"
  // ou "ACCESS_TOKEN_SCOPE_INSUFFICIENT" também significa que o token não tem
  // o escopo certo — limpa cache e força nova autorização.
  const isScopeIssue =
    reason === 'insufficientPermissions' ||
    reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
    reason === 'authError';
  if (res.status === 401 || (res.status === 403 && isScopeIssue)) {
    clearCalendarToken();
    throw new CalendarAuthError(
      message || 'Acesso ao Google Calendar expirou ou foi revogado.',
    );
  }

  // 403 com reason "accessNotConfigured" = API não habilitada no projeto.
  // Mensagem específica para o usuário poder agir.
  if (res.status === 403 && reason === 'accessNotConfigured') {
    throw new Error(
      'A Google Calendar API não está habilitada neste projeto Firebase. ' +
        'Habilite em https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
    );
  }

  throw new Error(
    `Google Calendar API ${res.status}${reason ? ` (${reason})` : ''}: ${message || res.statusText}`,
  );
}

export async function listUpcomingPrimaryEvents(
  uid: string,
  token: string,
  options: { monthsAhead?: number; maxResults?: number } = {},
): Promise<CalendarEvent[]> {
  const monthsAhead = options.monthsAhead ?? 12;
  const maxResults = options.maxResults ?? 250;

  const timeMin = new Date();
  // Inclui o resto de hoje (zera horas para pegar eventos de hoje).
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setMonth(timeMax.getMonth() + monthsAhead);

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(maxResults),
  });

  const res = await callCalendarApi(
    uid,
    token,
    `/calendars/primary/events?${params.toString()}`,
  );
  const json = (await res.json()) as { items?: GoogleEvent[] };
  const items = (json.items ?? [])
    .map(toCalendarEvent)
    .filter((e): e is CalendarEvent => e !== null);

  // Dedup eventos recorrentes: como singleEvents=true expande as ocorrências
  // e orderBy=startTime já vem cronológico, basta manter a primeira de cada
  // série (recurringEventId).
  const seenSeries = new Set<string>();
  const deduped: CalendarEvent[] = [];
  for (const e of items) {
    if (e.recurringEventId) {
      if (seenSeries.has(e.recurringEventId)) continue;
      seenSeries.add(e.recurringEventId);
    }
    deduped.push(e);
  }
  return deduped;
}

export type CreateEventInput = {
  summary: string;
  date: string; // "YYYY-MM-DD"
  time?: string; // "HH:MM" — se ausente, evento all-day
  description?: string;
};

export async function createPrimaryEvent(
  uid: string,
  token: string,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const body: Record<string, unknown> = { summary: input.summary };
  if (input.description) body.description = input.description;

  if (input.time) {
    // Evento com horário: 1h de duração por padrão. Usa timezone do navegador.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = `${input.date}T${input.time}:00`;
    const startDate = new Date(`${start}`);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    body.start = { dateTime: start, timeZone: tz };
    body.end = {
      dateTime: endDate.toISOString().slice(0, 19),
      timeZone: tz,
    };
  } else {
    // All-day: end.date é exclusivo no formato Calendar, então é dia+1.
    const startD = new Date(`${input.date}T00:00:00`);
    const endD = new Date(startD.getTime() + 24 * 60 * 60 * 1000);
    const endStr = endD.toISOString().slice(0, 10);
    body.start = { date: input.date };
    body.end = { date: endStr };
  }

  const res = await callCalendarApi(uid, token, `/calendars/primary/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const created = (await res.json()) as GoogleEvent;
  const mapped = toCalendarEvent(created);
  if (!mapped) {
    throw new Error('Evento criado mas resposta inválida do Google.');
  }
  return mapped;
}

// Cache do último snapshot de eventos. Usado para mostrar os contadores
// imediatamente ao abrir a aba (otimista) e para sustentar o banner discreto
// "Calendário desconectado" sem esvaziar a tela quando o refresh falha.

type CachedEvents = {
  uid: string;
  fetchedAt: number;
  events: CalendarEvent[];
};

export function readCachedEvents(uid: string): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(EVENTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEvents;
    if (parsed.uid !== uid || !Array.isArray(parsed.events)) return null;
    return parsed.events;
  } catch {
    return null;
  }
}

export function writeCachedEvents(uid: string, events: CalendarEvent[]): void {
  try {
    const payload: CachedEvents = { uid, fetchedAt: Date.now(), events };
    localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // sem espaço — segue sem cachear
  }
}

// Calcula dias inteiros restantes até a data do evento, no fuso local.
// Para all-day: usa só a data; para timed: ainda compara só a data (faz sentido
// para a tela de "dias restantes").
export function daysUntil(event: CalendarEvent, today = new Date()): number {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();

  let eventDate: Date;
  if (event.startIsAllDay) {
    const [y, m, d] = event.startDate.split('-').map(Number);
    eventDate = new Date(y, (m ?? 1) - 1, d ?? 1);
  } else {
    eventDate = new Date(event.startDate);
  }
  const startOfEvent = new Date(
    eventDate.getFullYear(),
    eventDate.getMonth(),
    eventDate.getDate(),
  ).getTime();

  const diffMs = startOfEvent - startOfToday;
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}
