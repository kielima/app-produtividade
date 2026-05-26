import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { TaskCard } from '../components/TaskCard';
import {
  WeatherIcon,
  weatherKindFromCode,
  weatherLabel,
  type WeatherKind,
} from '../components/WeatherIcon';
import { auth } from '../lib/firebase';
import {
  CalendarAuthError,
  daysUntil,
  ensureCalendarToken,
  getCachedCalendarToken,
  grantCalendarAccess,
  listUpcomingPrimaryEvents,
  type CalendarEvent,
} from '../lib/googleCalendar';
import { getDisplayTitle } from '../lib/parser';
import { useProjectNavigation } from '../lib/projectNavigation';
import { calcScore, isTaskBlocked } from '../lib/score';
import { subscribeToCompletedTasks } from '../repositories/tasksRepo';
import type {
  CompletedTask,
  Esforco,
  MoSCoW,
  Project,
  ScoreContext,
  Task,
} from '../types';

type WeatherLocation = { id: string; name: string; lat: number; lon: number };

const WEATHER_LOCATIONS: WeatherLocation[] = [
  { id: 'taubate', name: 'Taubaté', lat: -23.0264, lon: -45.555 },
  { id: 'campinas', name: 'Campinas', lat: -22.9056, lon: -47.0608 },
];

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function firstNameOf(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0];
  return first || null;
}

// Calcula a sequência atual: dias consecutivos com pelo menos uma tarefa
// concluída terminando em hoje (ou ontem, se hoje ainda não houve tarefas).
function computeCurrentStreak(tasks: CompletedTask[], today: Date): number {
  const daysWithTasks = new Set<string>();
  for (const t of tasks) {
    if (!t.archivedAt) continue;
    daysWithTasks.add(dayKey(startOfDay(t.archivedAt)));
  }
  let cursor = startOfDay(today);
  if (!daysWithTasks.has(dayKey(cursor))) {
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (daysWithTasks.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Categoriza o índice UV pela classificação da OMS.
function describeUv(uv: number): { level: string; className: string } {
  if (uv < 3) return { level: 'baixo', className: 'today-uv--low' };
  if (uv < 6) return { level: 'moderado', className: 'today-uv--moderate' };
  if (uv < 8) return { level: 'alto', className: 'today-uv--high' };
  if (uv < 11) return { level: 'muito alto', className: 'today-uv--very-high' };
  return { level: 'extremo', className: 'today-uv--extreme' };
}

type WeatherState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      tempMin: number;
      tempMax: number;
      uvNow: number;
      uvMax: number;
      code: number;
    };

// Cache em sessionStorage: ttl curto evita refetch a cada montagem da home
// (carrossel monta um hook por cidade), mas mantém os dados frescos o
// suficiente para a UV "agora" não envelhecer demais.
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

type WeatherCachePayload = {
  code: number;
  tempMin: number;
  tempMax: number;
  uvNow: number;
  uvMax: number;
};

function weatherCacheKey(lat: number, lon: number): string {
  return `weather:v1:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function readWeatherCache(lat: number, lon: number): WeatherCachePayload | null {
  try {
    const raw = sessionStorage.getItem(weatherCacheKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: WeatherCachePayload };
    if (
      !parsed ||
      typeof parsed.ts !== 'number' ||
      Date.now() - parsed.ts > WEATHER_CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeWeatherCache(
  lat: number,
  lon: number,
  data: WeatherCachePayload,
): void {
  try {
    sessionStorage.setItem(
      weatherCacheKey(lat, lon),
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    // sessionStorage indisponível ou quota cheia — silenciar.
  }
}

function useWeather(lat: number, lon: number): {
  state: WeatherState;
  retry: () => void;
} {
  const [state, setState] = useState<WeatherState>(() => {
    const cached = readWeatherCache(lat, lon);
    return cached ? { kind: 'ready', ...cached } : { kind: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    // Em retries explícitos (attempt > 0) ignoramos o cache para forçar
    // refetch; na montagem inicial, se houver cache válido pulamos a rede.
    if (attempt === 0) {
      const cached = readWeatherCache(lat, lon);
      if (cached) {
        setState({ kind: 'ready', ...cached });
        return;
      }
    }
    setState({ kind: 'loading' });
    (async () => {
      try {
        const params = new URLSearchParams({
          latitude: String(lat),
          longitude: String(lon),
          current: 'uv_index',
          daily:
            'weather_code,temperature_2m_max,temperature_2m_min,uv_index_max',
          timezone: 'auto',
          forecast_days: '1',
        });
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          current?: { uv_index?: number };
          daily?: {
            weather_code?: number[];
            temperature_2m_max?: number[];
            temperature_2m_min?: number[];
            uv_index_max?: number[];
          };
        };
        const code = json.daily?.weather_code?.[0];
        const tMax = json.daily?.temperature_2m_max?.[0];
        const tMin = json.daily?.temperature_2m_min?.[0];
        const uvMax = json.daily?.uv_index_max?.[0];
        const uvNow = json.current?.uv_index;
        if (
          code == null ||
          tMax == null ||
          tMin == null ||
          uvMax == null ||
          uvNow == null
        ) {
          throw new Error('Resposta de previsão inválida.');
        }
        const payload: WeatherCachePayload = {
          code,
          tempMin: tMin,
          tempMax: tMax,
          uvNow,
          uvMax,
        };
        writeWeatherCache(lat, lon, payload);
        if (cancelled) return;
        setState({ kind: 'ready', ...payload });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lon, attempt]);

  return { state, retry };
}

type EventsState =
  | { kind: 'idle' }
  | { kind: 'no-token' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; events: CalendarEvent[] };

function useUpcomingWeekEvents(uid: string, triggerKey: number): EventsState {
  const [state, setState] = useState<EventsState>({ kind: 'idle' });

  useEffect(() => {
    const cached = getCachedCalendarToken(uid);
    if (!cached) {
      setState({ kind: 'no-token' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const token = await ensureCalendarToken(uid);
        const list = await listUpcomingPrimaryEvents(uid, token, {
          monthsAhead: 1,
          maxResults: 50,
        });
        if (cancelled) return;
        const now = new Date();
        const within7 = list.filter((e) => {
          const d = daysUntil(e, now);
          return d >= 0 && d <= 7;
        });
        setState({ kind: 'ready', events: within7 });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CalendarAuthError) {
          setState({ kind: 'no-token' });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, triggerKey]);

  return state;
}

function formatEventDate(event: CalendarEvent): string {
  if (event.startIsAllDay) {
    const [y, m, d] = event.startDate.split('-').map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    return dt.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
  }
  const dt = new Date(event.startDate);
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysLabel(days: number): { value: string; label: string } {
  if (days === 0) return { value: 'Hoje', label: '' };
  if (days === 1) return { value: '1', label: 'Dia' };
  return { value: String(days), label: 'Dias' };
}

const TODAY_PICKS_KEY = 'app-produtividade:today-picks';

interface StoredPicks {
  date: string;
  uid: string;
  ids: string[];
}

function loadStoredPicks(uid: string): StoredPicks | null {
  try {
    const raw = localStorage.getItem(TODAY_PICKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPicks;
    if (
      typeof parsed.date !== 'string' ||
      typeof parsed.uid !== 'string' ||
      !Array.isArray(parsed.ids) ||
      parsed.uid !== uid
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredPicks(picks: StoredPicks): void {
  try {
    localStorage.setItem(TODAY_PICKS_KEY, JSON.stringify(picks));
  } catch {
    // ignore — modo privado / sem espaço
  }
}

// Heatmap de Atividade — cópia local do chart usado em EstatisticasView.
// Mantido aqui para que a tela seja autocontida sem mover o original.
const ACTIVITY_RANGES: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 365, label: '1 ano' },
];
const ACTIVITY_DEFAULT_RANGE_DAYS = 90;

const ACTIVITY_MOSCOW_PTS: Record<MoSCoW, number> = {
  must: 3,
  should: 2,
  could: 1,
  wont: 0,
  '': 1,
};

const ACTIVITY_EFFORT_DIV: Record<Esforco, number> = {
  rapido: 1,
  medio: 2,
  longo: 3,
  '': 1,
};

function formatActivityBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function activityIntrinsicValue(
  task: CompletedTask,
  projectScoreMap: Record<string, number>,
): number {
  const sectionId = task.archivedFromSection || task.section;
  const projectScore = sectionId ? projectScoreMap[sectionId] ?? 0 : 0;
  const moscowPts = ACTIVITY_MOSCOW_PTS[task.moscow] ?? 1;
  const effortDiv = ACTIVITY_EFFORT_DIV[task.esforco] ?? 1;
  return (projectScore * moscowPts) / effortDiv;
}

interface ActivityDayBucket {
  date: Date;
  key: string;
  count: number;
  score: number;
}

function buildActivityBuckets(
  tasks: CompletedTask[],
  projectScoreMap: Record<string, number>,
  rangeDays: number,
): ActivityDayBucket[] {
  const today = startOfDay(new Date());
  const buckets: ActivityDayBucket[] = [];
  const index = new Map<string, ActivityDayBucket>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const b: ActivityDayBucket = {
      date: d,
      key: dayKey(d),
      count: 0,
      score: 0,
    };
    buckets.push(b);
    index.set(b.key, b);
  }
  for (const t of tasks) {
    if (!t.archivedAt) continue;
    const k = dayKey(startOfDay(t.archivedAt));
    const b = index.get(k);
    if (!b) continue;
    const v = activityIntrinsicValue(t, projectScoreMap);
    b.count += 1;
    b.score += v;
  }
  return buckets;
}

function ActivityHeatmap({ buckets }: { buckets: ActivityDayBucket[] }) {
  const max = Math.max(0, ...buckets.map((b) => b.count));
  const todayKey = dayKey(startOfDay(new Date()));

  function level(value: number): number {
    if (value < 0) return -1;
    if (value === 0) return 0;
    if (max === 0) return 0;
    const ratio = value / max;
    if (ratio > 0.66) return 4;
    if (ratio > 0.33) return 3;
    if (ratio > 0.1) return 2;
    return 1;
  }

  function cellTitle(date: Date, value: number, isToday: boolean): string {
    const prefix = isToday ? 'Hoje · ' : '';
    return `${prefix}${formatActivityBR(date)} — ${value.toFixed(0)} tarefas`;
  }

  if (buckets.length <= 7) {
    return (
      <div
        className="stats-heatmap stats-heatmap--row"
        role="grid"
        aria-label="Heatmap de tarefas concluídas"
      >
        {buckets.map((b) => {
          const v = b.count;
          const lvl = level(v);
          const isToday = b.key === todayKey;
          const title = cellTitle(b.date, v, isToday);
          const todayClass = isToday ? ' stats-heatmap-cell--today' : '';
          return (
            <div
              key={b.key}
              className={`stats-heatmap-cell stats-heatmap-cell--${lvl}${todayClass}`}
              title={title}
              aria-label={title}
              role="gridcell"
            >
              {isToday ? 'H' : v > 0 ? v : ''}
            </div>
          );
        })}
      </div>
    );
  }

  const today = startOfDay(new Date());
  const anchor = new Date(today);
  anchor.setDate(anchor.getDate() - anchor.getDay());

  const weeksToShow = Math.ceil(buckets.length / 7);
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  const cells: Array<{ key: string; value: number; date: Date | null }> = [];
  for (let col = weeksToShow - 1; col >= 0; col--) {
    for (let row = 0; row < 7; row++) {
      const d = new Date(anchor);
      d.setDate(d.getDate() - col * 7 + row);
      const k = dayKey(d);
      const b = byKey.get(k);
      const value = b ? b.count : 0;
      const inRange = d <= today && b != null;
      cells.push({
        key: `${col}-${row}`,
        value: inRange ? value : -1,
        date: inRange ? d : null,
      });
    }
  }

  return (
    <div
      className="stats-heatmap stats-heatmap--vertical"
      style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}
      role="grid"
      aria-label="Heatmap de tarefas concluídas"
    >
      {cells.map((c) => {
        const lvl = level(c.value);
        const isToday = c.date != null && dayKey(c.date) === todayKey;
        const title = c.date ? cellTitle(c.date, c.value, isToday) : '';
        const todayClass = isToday ? ' stats-heatmap-cell--today' : '';
        return (
          <div
            key={c.key}
            className={`stats-heatmap-cell stats-heatmap-cell--${lvl}${todayClass}`}
            title={title}
            aria-label={title}
            role="gridcell"
          >
            {isToday ? 'H' : c.value > 0 ? c.value : ''}
          </div>
        );
      })}
    </div>
  );
}

function ActivityView({
  tasks,
  projectScoreMap,
  onClose,
}: {
  tasks: CompletedTask[];
  projectScoreMap: Record<string, number>;
  onClose: () => void;
}) {
  const [rangeDays, setRangeDays] = useState<number>(ACTIVITY_DEFAULT_RANGE_DAYS);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const buckets = useMemo(
    () => buildActivityBuckets(tasks, projectScoreMap, rangeDays),
    [tasks, projectScoreMap, rangeDays],
  );

  return (
    <section
      className="activity-view"
      role="region"
      aria-label="Atividade"
    >
      <header className="activity-view-topbar">
        <button
          type="button"
          className="icon-btn activity-view-back"
          onClick={onClose}
          aria-label="voltar"
          title="Voltar"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className="activity-view-title">Atividade</h2>
      </header>

      <div
        className="activity-view-ranges"
        role="radiogroup"
        aria-label="Período"
      >
        {ACTIVITY_RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            role="radio"
            aria-checked={rangeDays === r.days}
            className={`stats-chip ${rangeDays === r.days ? 'stats-chip--active' : ''}`}
            onClick={() => setRangeDays(r.days)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="activity-view-chart">
        <ActivityHeatmap buckets={buckets} />
      </div>
    </section>
  );
}

interface TodayViewProps {
  uid: string;
  tasks: Task[];
  projects: Project[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
}

export function TodayView({
  uid,
  tasks,
  projects,
  projectMap,
  ctx,
}: TodayViewProps) {
  const { openProject, openProjectTasks } = useProjectNavigation();
  const [user] = useAuthState(auth);
  const [now, setNow] = useState(() => new Date());

  // Atualiza a cada minuto para a saudação trocar ao virar a hora.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const greeting = useMemo(() => greetingFor(now), [now]);
  const firstName = useMemo(() => firstNameOf(user?.displayName), [user?.displayName]);

  const [completed, setCompleted] = useState<CompletedTask[]>([]);
  useEffect(() => {
    const unsub = subscribeToCompletedTasks(uid, setCompleted);
    return unsub;
  }, [uid]);

  const currentStreak = useMemo(
    () => computeCurrentStreak(completed, now),
    [completed, now],
  );

  const topProject = useMemo<{ project: Project; score: number } | null>(() => {
    let best: { project: Project; score: number } | null = null;
    for (const p of projects) {
      if (p.status === 'Pausado' || p.status === 'Concluído' || p.status === 'Cancelado') {
        continue;
      }
      const score = ctx.projectScoreMap[p.id] ?? 0;
      if (!best || score > best.score) best = { project: p, score };
    }
    return best;
  }, [projects, ctx.projectScoreMap]);

  const taskCountByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.section] = (counts[t.section] ?? 0) + 1;
    return counts;
  }, [tasks]);

  // Snapshot diário das 3 tarefas: uma vez escolhidas para o dia, ficam
  // congeladas na tela (mesmo após marcadas como concluídas) e só são
  // renovadas no dia seguinte. Persistido em localStorage para sobreviver
  // a recargas e troca de aba.
  const todayKey = useMemo(() => dayKey(startOfDay(now)), [now]);
  const [pickedIds, setPickedIds] = useState<string[] | null>(() => {
    const stored = loadStoredPicks(uid);
    return stored && stored.date === todayKey ? stored.ids : null;
  });

  useEffect(() => {
    // Já temos picks válidos para hoje → mantém.
    if (pickedIds !== null) {
      const stored = loadStoredPicks(uid);
      if (stored && stored.date === todayKey) return;
    }
    // Aguarda os dados chegarem antes de computar pela primeira vez.
    if (tasks.length === 0) return;
    const top = tasks
      .filter((t) => !t.checked)
      .map((t) => ({
        task: t,
        score: calcScore(t, projectMap[t.section] ?? null, ctx),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.task.id);
    setPickedIds(top);
    saveStoredPicks({ date: todayKey, uid, ids: top });
  }, [uid, todayKey, tasks, projectMap, ctx, pickedIds]);

  // Resolve cada id para a tarefa atual (live) ou arquivada (completedTasks),
  // preservando a ordem do snapshot. Score só é recalculado para live; em
  // arquivadas não faz mais sentido.
  const pickedTasks = useMemo<
    Array<{ id: string; task: Task; score: number | undefined }>
  >(() => {
    if (!pickedIds || pickedIds.length === 0) return [];
    const liveById = new Map(tasks.map((t) => [t.id, t]));
    const archivedById = new Map(completed.map((t) => [t.id, t]));
    const out: Array<{ id: string; task: Task; score: number | undefined }> = [];
    for (const id of pickedIds) {
      const live = liveById.get(id);
      if (live) {
        out.push({
          id,
          task: live,
          score: calcScore(live, projectMap[live.section] ?? null, ctx),
        });
        continue;
      }
      const archived = archivedById.get(id);
      if (archived) {
        out.push({ id, task: archived, score: undefined });
      }
    }
    return out;
  }, [pickedIds, tasks, completed, projectMap, ctx]);

  const [calendarTrigger, setCalendarTrigger] = useState(0);
  const events = useUpcomingWeekEvents(uid, calendarTrigger);

  async function handleConnectCalendar() {
    try {
      await grantCalendarAccess(uid);
      setCalendarTrigger((n) => n + 1);
    } catch (err) {
      console.error('[TodayView] falha ao conectar Google Calendar:', err);
    }
  }

  const primaryLocation = WEATHER_LOCATIONS[0];
  const { state: primaryWeather } = useWeather(
    primaryLocation.lat,
    primaryLocation.lon,
  );
  const currentWeatherKind: WeatherKind =
    primaryWeather.kind === 'ready'
      ? weatherKindFromCode(primaryWeather.code)
      : 'unknown';

  const [weatherOpen, setWeatherOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  if (activityOpen) {
    return (
      <ActivityView
        tasks={completed}
        projectScoreMap={ctx.projectScoreMap}
        onClose={() => setActivityOpen(false)}
      />
    );
  }

  return (
    <section className="today-view">
      <div className="today-greeting-row">
        <div className="today-greeting-left">
          <h1 className="today-greeting">
            {firstName ? `${greeting}, ${firstName}!` : `${greeting}!`}
          </h1>
          <button
            type="button"
            className="today-weather-trigger"
            onClick={() => setWeatherOpen(true)}
            aria-label={`Clima: ${weatherLabel(currentWeatherKind)}. Toque para detalhes.`}
            title="Ver previsão do tempo"
          >
            <WeatherIcon kind={currentWeatherKind} size={35} />
          </button>
        </div>
        <StreakInline
          streak={currentStreak}
          onOpenActivity={() => setActivityOpen(true)}
        />
      </div>

      {weatherOpen && (
        <WeatherModal
          locations={WEATHER_LOCATIONS}
          onClose={() => setWeatherOpen(false)}
        />
      )}


      <div className="today-section">
        <h2 className="today-section-title">Projeto em destaque</h2>
        {topProject ? (
          (() => {
            const count = taskCountByProject[topProject.project.id] ?? 0;
            const countLabel = `${count} tarefa${count === 1 ? '' : 's'}`;
            return (
              <article className="today-project-card">
                <button
                  type="button"
                  className="today-project-name today-project-name-btn"
                  onClick={() => openProject(topProject.project.id)}
                  aria-label="abrir projeto"
                >
                  {topProject.project.name}
                </button>
                <button
                  type="button"
                  className="muted today-project-task-count"
                  onClick={() => openProjectTasks(topProject.project.id)}
                  aria-label={`ver ${countLabel} do projeto ${topProject.project.name}`}
                >
                  {countLabel}
                </button>
              </article>
            );
          })()
        ) : (
          <p className="muted">Crie um projeto para vê-lo aqui.</p>
        )}
      </div>

      <div className="today-section">
        <h2 className="today-section-title">Top 3 tarefas</h2>
        {pickedTasks.length === 0 ? (
          <p className="muted">Nenhuma tarefa com score &gt; 0.</p>
        ) : (
          <div className="task-list">
            {pickedTasks.map(({ id, task, score }) =>
              score !== undefined ? (
                <TaskCard
                  key={id}
                  uid={uid}
                  task={task}
                  blocked={isTaskBlocked(task, ctx)}
                />
              ) : (
                <ArchivedTaskCard key={id} task={task} />
              ),
            )}
          </div>
        )}
      </div>

      <div className="today-section">
        <h2 className="today-section-title">Próximos 7 dias</h2>
        <EventsList state={events} onConnect={handleConnectCalendar} />
      </div>
    </section>
  );
}

function WeatherModal({
  locations,
  onClose,
}: {
  locations: WeatherLocation[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal weather-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Previsão do tempo"
      >
        <header className="modal-header">
          <h3>Clima de hoje</h3>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn"
            style={{ fontSize: '25px' }}
            aria-label="fechar"
          >
            ×
          </button>
        </header>
        <div className="weather-modal-body">
          <WeatherCarousel locations={locations} />
        </div>
      </div>
    </div>
  );
}

function WeatherCarousel({ locations }: { locations: WeatherLocation[] }) {
  const [active, setActive] = useState(0);
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const trackWidth = useRef(0);

  const goTo = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(locations.length - 1, idx));
      setActive(clamped);
    },
    [locations.length],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startX.current = e.clientX;
    trackWidth.current = trackRef.current?.offsetWidth ?? 0;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return;
    setDragX(e.clientX - startX.current);
  };
  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return;
    const w = trackWidth.current || trackRef.current?.offsetWidth || 0;
    const threshold = Math.max(60, w * 0.18);
    if (dragX <= -threshold) goTo(active + 1);
    else if (dragX >= threshold) goTo(active - 1);
    startX.current = null;
    setDragX(0);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const dragging = startX.current !== null;
  const w = trackWidth.current || 1;
  const dragPercent = (dragX / w) * 100;
  const offsetPct = -active * 100 + dragPercent;

  return (
    <div className="today-weather-carousel">
      <div
        className="weather-carousel-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          ref={trackRef}
          className="weather-carousel-track"
          style={{
            transform: `translateX(${offsetPct}%)`,
            transition: dragging
              ? 'none'
              : 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          {locations.map((loc) => (
            <div key={loc.id} className="weather-carousel-slide">
              <WeatherSlide location={loc} />
            </div>
          ))}
        </div>
      </div>
      {locations.length > 1 && (
        <div
          className="weather-carousel-dots"
          role="tablist"
          aria-label="Selecionar cidade"
        >
          {locations.map((loc, i) => (
            <button
              key={loc.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={loc.name}
              className={`weather-carousel-dot${
                i === active ? ' is-active' : ''
              }`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WeatherSlide({ location }: { location: WeatherLocation }) {
  const { state, retry } = useWeather(location.lat, location.lon);
  return <WeatherCard state={state} city={location.name} onRetry={retry} />;
}

function WeatherCard({
  state,
  city,
  onRetry,
}: {
  state: WeatherState;
  city: string;
  onRetry: () => void;
}) {
  const [uvExpanded, setUvExpanded] = useState(false);

  if (state.kind === 'loading') {
    return (
      <div className="today-card today-weather">
        <div className="today-weather-header">
          <span className="today-card-label">Clima de hoje</span>
          <span className="today-weather-city">{city}</span>
        </div>
        <div className="muted">Carregando previsão…</div>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="today-card today-weather">
        <div className="today-weather-header">
          <span className="today-card-label">Clima de hoje</span>
          <span className="today-weather-city">{city}</span>
        </div>
        <div className="error">{state.message}</div>
        <button type="button" className="link-btn" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    );
  }
  const kind: WeatherKind = weatherKindFromCode(state.code);
  const uvNow = describeUv(state.uvNow);
  const uvMax = describeUv(state.uvMax);
  return (
    <div className="today-card today-weather">
      <div className="today-weather-header">
        <span className="today-card-label">Clima de hoje</span>
        <span className="today-weather-city">{city}</span>
      </div>
      <div className="today-weather-main">
        <WeatherIcon kind={kind} size={64} className="today-weather-icon" />
        <div className="today-weather-temps">
          <div className="today-weather-condition">{weatherLabel(kind)}</div>
          <div className="today-weather-range">
            {Math.round(state.tempMin)}° / {Math.round(state.tempMax)}°C
          </div>
        </div>
        <button
          type="button"
          className={`today-uv-toggle ${uvNow.className}`}
          aria-expanded={uvExpanded}
          aria-label={`Índice UV: ${state.uvNow.toFixed(1)}, ${uvNow.level}. Toque para ${uvExpanded ? 'recolher' : 'ver'} detalhes.`}
          title={`UV agora: ${state.uvNow.toFixed(1)} (${uvNow.level})`}
          onClick={() => setUvExpanded((v) => !v)}
        >
          {Math.round(state.uvNow)}
        </button>
      </div>
      {uvExpanded && (
        <div className="today-uv-row">
          <div className={`today-uv ${uvNow.className}`}>
            <span className="today-uv-label">UV agora</span>
            <span className="today-uv-value">
              {state.uvNow.toFixed(1)}
              <small> · {uvNow.level}</small>
            </span>
          </div>
          <div className={`today-uv ${uvMax.className}`}>
            <span className="today-uv-label">UV máx. hoje</span>
            <span className="today-uv-value">
              {state.uvMax.toFixed(1)}
              <small> · {uvMax.level}</small>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ArchivedTaskCard({ task }: { task: Task }) {
  const display = getDisplayTitle(task.title);
  // Tarefa já arquivada em completedTasks/: render só leitura — o detalhe
  // não está mais acessível (TaskDetailView só lê de tasks/).
  return (
    <article className="task-card done">
      <div className="task-line">
        <input
          type="checkbox"
          checked
          readOnly
          aria-label="tarefa concluída"
          className="task-checkbox"
        />
        <span className="task-title">{display}</span>
      </div>
    </article>
  );
}

function StreakInline({
  streak,
  onOpenActivity,
}: {
  streak: number;
  onOpenActivity: () => void;
}) {
  const active = streak > 0;
  return (
    <div
      className="today-streak-inline"
      aria-label={`Sequência atual: ${streak} dia${streak === 1 ? '' : 's'} seguido${streak === 1 ? '' : 's'}`}
    >
      <span className="today-streak-inline-value">{streak}</span>
      <button
        type="button"
        className={`today-streak-flame-btn today-streak-flame${active ? '' : ' today-streak-flame--off'}`}
        onClick={onOpenActivity}
        aria-label="Ver gráfico de atividade"
        title="Ver atividade"
      >
        <svg width="35" height="35" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12.395 2.553a1 1 0 0 0-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.4 31.4 0 0 0-.613 3.58 2.64 2.64 0 0 1-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 0 0 5.05 6.05 6.981 6.981 0 0 0 3 11a7 7 0 1 0 11.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 0 1 7 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A3 3 0 0 1 12.12 15.12z"
          />
        </svg>
      </button>
    </div>
  );
}

function EventsList({ state, onConnect }: { state: EventsState; onConnect?: () => void }) {
  if (state.kind === 'idle' || state.kind === 'loading') {
    return <p className="muted">Carregando eventos…</p>;
  }
  if (state.kind === 'no-token') {
    return (
      <div className="countdown-connect">
        <p className="muted">
          Conecte sua conta Google para sincronizar os eventos do seu calendário.
        </p>
        {onConnect && (
          <button type="button" className="btn-primary" onClick={onConnect}>
            Conectar Google Calendar
          </button>
        )}
      </div>
    );
  }
  if (state.kind === 'error') {
    return <p className="error">{state.message}</p>;
  }
  if (state.events.length === 0) {
    return <p className="muted">Nenhum evento nos próximos 7 dias.</p>;
  }
  const now = new Date();
  return (
    <div className="countdown-list">
      {state.events.map((event) => {
        const days = daysUntil(event, now);
        const { value, label } = daysLabel(days);
        const card = (
          <article className="countdown-card" key={event.id}>
            <div className="countdown-card-icon" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" x2="16" y1="2" y2="6" />
                <line x1="8" x2="8" y1="2" y2="6" />
                <line x1="3" x2="21" y1="10" y2="10" />
              </svg>
            </div>
            <div className="countdown-card-body">
              <p className="countdown-card-title">{event.summary}</p>
              <p className="countdown-card-date muted">
                {formatEventDate(event)}
              </p>
            </div>
            <div className="countdown-card-count">
              <span className="countdown-card-value">{value}</span>
              {label && <span className="countdown-card-label">{label}</span>}
            </div>
          </article>
        );
        if (event.htmlLink) {
          return (
            <a
              key={event.id}
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="countdown-card-link"
            >
              {card}
            </a>
          );
        }
        return card;
      })}
    </div>
  );
}
