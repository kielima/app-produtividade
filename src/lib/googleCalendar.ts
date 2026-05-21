import { auth } from './firebase';

// Escopo de leitura/escrita de eventos. Cobre os dois usos da aba Contagem
// Regressiva: listar próximos eventos e criar novos via FAB.
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'app-produtividade:gcal-token';

type StoredToken = {
  accessToken: string;
  expiresAt: number;
  uid: string;
};

type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GisTokenClient = {
  callback: (resp: GisTokenResponse) => void;
  error_callback?: (err: { type: string; message?: string }) => void;
  requestAccessToken: (overrides?: { prompt?: string; hint?: string }) => void;
};

type GisOAuth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
  }) => GisTokenClient;
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
}

export function clearCalendarToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
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

let tokenClient: GisTokenClient | null = null;

async function getTokenClient(): Promise<GisTokenClient> {
  if (tokenClient) return tokenClient;
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
  tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: CALENDAR_SCOPE,
    callback: () => {
      // Sobrescrito a cada chamada de requestToken.
    },
  });
  return tokenClient;
}

async function requestToken(
  uid: string,
  prompt: '' | 'none' | 'consent',
): Promise<string> {
  const client = await getTokenClient();
  return new Promise<string>((resolve, reject) => {
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error));
        return;
      }
      if (!resp.access_token) {
        reject(new Error('Google não devolveu access_token.'));
        return;
      }
      // expires_in vem em segundos; cacheamos com margem de 60s.
      const ttlMs = (resp.expires_in ?? 3600) * 1000;
      const expiresAt = Date.now() + ttlMs - 60_000;
      writeStored({ accessToken: resp.access_token, expiresAt, uid });
      resolve(resp.access_token);
    };
    client.error_callback = (err) => {
      reject(new Error(err.message || err.type || 'Falha ao obter token.'));
    };
    const overrides: { prompt?: string; hint?: string } = { prompt };
    const email = auth.currentUser?.email;
    if (email) overrides.hint = email;
    client.requestAccessToken(overrides);
  });
}

// Renovação silenciosa: usa a sessão Google ativa no navegador via iframe
// invisível. Se o usuário não estiver logado no Google ou nunca consentiu,
// retorna null sem mostrar UI (não força popup).
export async function tryRefreshCalendarToken(
  uid: string,
): Promise<string | null> {
  try {
    return await requestToken(uid, 'none');
  } catch (err) {
    console.debug('[gcal] silent refresh falhou:', err);
    return null;
  }
}

// Interativo: pode mostrar consent se for a primeira vez ou se o usuário
// revogou o acesso. Se já consentiu antes, GIS resolve via iframe sem popup.
export async function grantCalendarAccess(uid: string): Promise<string> {
  return requestToken(uid, '');
}

export async function ensureCalendarToken(uid: string): Promise<string> {
  const cached = getCachedCalendarToken(uid);
  if (cached) return cached;
  const silent = await tryRefreshCalendarToken(uid);
  if (silent) return silent;
  return grantCalendarAccess(uid);
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
