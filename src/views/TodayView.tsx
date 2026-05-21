import { useCallback, useEffect, useMemo, useState } from 'react';
import { TaskCard } from '../components/TaskCard';
import {
  CalendarAuthError,
  daysUntil,
  ensureCalendarToken,
  getCachedCalendarToken,
  listUpcomingPrimaryEvents,
  type CalendarEvent,
} from '../lib/googleCalendar';
import { getDisplayTitle } from '../lib/parser';
import { useProjectNavigation } from '../lib/projectNavigation';
import { calcScore, isTaskBlocked } from '../lib/score';
import { subscribeToCompletedTasks } from '../repositories/tasksRepo';
import type { CompletedTask, Project, ScoreContext, Task } from '../types';

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

// Mapeia o WMO weather code do Open-Meteo para emoji + label legível em PT-BR.
// Tabela: https://open-meteo.com/en/docs (seção "Weather variable documentation")
function describeWeatherCode(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'Céu limpo' };
  if (code === 1) return { icon: '🌤️', label: 'Predominantemente limpo' };
  if (code === 2) return { icon: '⛅', label: 'Parcialmente nublado' };
  if (code === 3) return { icon: '☁️', label: 'Nublado' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Neblina' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Garoa' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: 'Chuva' };
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: 'Neve' };
  if (code >= 80 && code <= 82) return { icon: '🌦️', label: 'Pancadas de chuva' };
  if (code >= 85 && code <= 86) return { icon: '🌨️', label: 'Pancadas de neve' };
  if (code === 95) return { icon: '⛈️', label: 'Trovoada' };
  if (code === 96 || code === 99) return { icon: '⛈️', label: 'Trovoada com granizo' };
  return { icon: '🌡️', label: 'Tempo desconhecido' };
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
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      tempMin: number;
      tempMax: number;
      uvNow: number;
      uvMax: number;
      code: number;
    };

function useWeather(): { state: WeatherState; retry: () => void } {
  const [state, setState] = useState<WeatherState>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ kind: 'unsupported' });
      return;
    }
    setState({ kind: 'loading' });
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
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
          if (cancelled) return;
          setState({
            kind: 'ready',
            tempMin: tMin,
            tempMax: tMax,
            uvNow,
            uvMax,
            code,
          });
        } catch (err) {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setState({ kind: 'error', message });
        }
      },
      (err) => {
        if (cancelled) return;
        if (err.code === err.PERMISSION_DENIED) {
          setState({ kind: 'denied' });
        } else {
          setState({ kind: 'error', message: err.message });
        }
      },
      { maximumAge: 30 * 60 * 1000, timeout: 10_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { state, retry };
}

type EventsState =
  | { kind: 'idle' }
  | { kind: 'no-token' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; events: CalendarEvent[] };

function useUpcomingWeekEvents(uid: string): EventsState {
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
  }, [uid]);

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
  const { openProject } = useProjectNavigation();
  const [now, setNow] = useState(() => new Date());

  // Atualiza a cada minuto para a saudação trocar ao virar a hora.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const greeting = useMemo(() => greetingFor(now), [now]);

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
      const score = ctx.projectScoreMap[p.id] ?? 0;
      if (!best || score > best.score) best = { project: p, score };
    }
    return best;
  }, [projects, ctx.projectScoreMap]);

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

  const { state: weather, retry: retryWeather } = useWeather();
  const events = useUpcomingWeekEvents(uid);

  return (
    <section className="today-view">
      <h1 className="today-greeting">{greeting}!</h1>

      <div className="today-grid">
        <WeatherCard state={weather} onRetry={retryWeather} />
        <StreakCard streak={currentStreak} />
      </div>

      <div className="today-section">
        <h2 className="today-section-title">Projeto em destaque</h2>
        {topProject ? (
          <button
            type="button"
            className="today-project-card"
            onClick={() => openProject(topProject.project.id)}
          >
            <div className="today-project-name">{topProject.project.name}</div>
            <div className="today-project-score">
              {topProject.score.toFixed(2)}
              <small> pts</small>
            </div>
          </button>
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
                  score={score}
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
        <EventsList state={events} />
      </div>
    </section>
  );
}

function WeatherCard({
  state,
  onRetry,
}: {
  state: WeatherState;
  onRetry: () => void;
}) {
  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <div className="today-card today-weather">
        <div className="today-card-label">Clima de hoje</div>
        <div className="muted">Carregando previsão…</div>
      </div>
    );
  }
  if (state.kind === 'unsupported') {
    return (
      <div className="today-card today-weather">
        <div className="today-card-label">Clima de hoje</div>
        <div className="muted">Geolocalização não suportada.</div>
      </div>
    );
  }
  if (state.kind === 'denied') {
    return (
      <div className="today-card today-weather">
        <div className="today-card-label">Clima de hoje</div>
        <div className="muted">
          Permita o acesso à localização no navegador para ver a previsão.
        </div>
        <button type="button" className="link-btn" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="today-card today-weather">
        <div className="today-card-label">Clima de hoje</div>
        <div className="error">{state.message}</div>
        <button type="button" className="link-btn" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    );
  }
  const desc = describeWeatherCode(state.code);
  const uvNow = describeUv(state.uvNow);
  const uvMax = describeUv(state.uvMax);
  return (
    <div className="today-card today-weather">
      <div className="today-card-label">Clima de hoje</div>
      <div className="today-weather-main">
        <span className="today-weather-icon" aria-hidden="true">
          {desc.icon}
        </span>
        <div className="today-weather-temps">
          <div className="today-weather-condition">{desc.label}</div>
          <div className="today-weather-range">
            {Math.round(state.tempMin)}° / {Math.round(state.tempMax)}°C
          </div>
        </div>
      </div>
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

function StreakCard({ streak }: { streak: number }) {
  const active = streak > 0;
  return (
    <div className="today-card today-streak">
      <div className="today-card-label">Sequência atual</div>
      <div className="today-streak-main">
        <div className="today-streak-value">
          {streak}
          <small>
            {' '}
            dia{streak === 1 ? '' : 's'} seguido{streak === 1 ? '' : 's'}
          </small>
        </div>
        <span
          className={`today-streak-flame${active ? '' : ' today-streak-flame--off'}`}
          aria-hidden="true"
        >
          <svg width="40" height="40" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12.395 2.553a1 1 0 0 0-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.4 31.4 0 0 0-.613 3.58 2.64 2.64 0 0 1-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 0 0 5.05 6.05 6.981 6.981 0 0 0 3 11a7 7 0 1 0 11.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 0 1 7 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A3 3 0 0 1 12.12 15.12z"
            />
          </svg>
        </span>
      </div>
      {!active && (
        <p className="muted today-streak-hint">
          Conclua uma tarefa hoje para começar.
        </p>
      )}
    </div>
  );
}

function EventsList({ state }: { state: EventsState }) {
  if (state.kind === 'idle' || state.kind === 'loading') {
    return <p className="muted">Carregando eventos…</p>;
  }
  if (state.kind === 'no-token') {
    return (
      <p className="muted">
        Conecte o Google Calendar na aba Contagem Regressiva para ver os
        eventos aqui.
      </p>
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
