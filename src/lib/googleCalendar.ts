import {
  GoogleAuthProvider,
  signInWithPopup,
  type UserCredential,
} from 'firebase/auth';
import { auth } from './firebase';

// Escopo de leitura/escrita de eventos. Cobre os dois usos da aba Contagem
// Regressiva: listar próximos eventos e criar novos via FAB.
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const TOKEN_KEY = 'app-produtividade:gcal-token';

type StoredToken = {
  accessToken: string;
  expiresAt: number;
  uid: string;
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

export async function grantCalendarAccess(uid: string): Promise<string> {
  const provider = new GoogleAuthProvider();
  provider.addScope(CALENDAR_SCOPE);
  // login_hint reduz a chance de o popup pedir escolha de conta quando o
  // usuário já está logado com a conta esperada. Sem prompt=consent — Google
  // pode auto-aprovar refresh de token quando o escopo já foi concedido.
  const currentEmail = auth.currentUser?.email;
  if (currentEmail) {
    provider.setCustomParameters({ login_hint: currentEmail });
  }

  const result: UserCredential = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  if (!accessToken) {
    throw new Error('Google não devolveu token de acesso para o Calendar.');
  }

  // Tokens OAuth do Google têm validade ~1h. Como o SDK não expõe expires_in
  // diretamente aqui, cacheamos por 55min — suficiente para a sessão típica.
  const expiresAt = Date.now() + 55 * 60 * 1000;
  writeStored({ accessToken, expiresAt, uid });
  return accessToken;
}

export async function ensureCalendarToken(uid: string): Promise<string> {
  const cached = getCachedCalendarToken(uid);
  if (cached) return cached;
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
  if (res.status === 401 || res.status === 403) {
    clearCalendarToken();
    throw new CalendarAuthError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Google Calendar API ${res.status}: ${text || res.statusText}`,
    );
  }
  // marker p/ evitar warning "uid não usado"
  void uid;
  return res;
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
