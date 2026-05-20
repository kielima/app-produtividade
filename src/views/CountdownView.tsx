import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarAuthError,
  clearCalendarToken,
  createPrimaryEvent,
  daysUntil,
  ensureCalendarToken,
  getCachedCalendarToken,
  grantCalendarAccess,
  listUpcomingPrimaryEvents,
  type CalendarEvent,
} from '../lib/googleCalendar';

function formatEventDate(event: CalendarEvent): string {
  if (event.startIsAllDay) {
    const [y, m, d] = event.startDate.split('-').map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    return dt.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: dt.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
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
  if (days === 1) return { value: '1', label: 'Dia Restante' };
  if (days < 0) {
    const abs = Math.abs(days);
    return { value: String(abs), label: abs === 1 ? 'Dia Atrás' : 'Dias Atrás' };
  }
  return { value: String(days), label: 'Dias Restantes' };
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'needs-auth' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

export function CountdownView({ uid }: { uid: string }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [showForm, setShowForm] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Mantém o "hoje" atualizado caso a aba fique aberta cruzando meia-noite,
  // para os contadores não ficarem desatualizados.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (interactive: boolean) => {
    setState({ kind: 'loading' });
    try {
      const token = interactive
        ? await ensureCalendarToken(uid)
        : getCachedCalendarToken(uid);
      if (!token) {
        setState({ kind: 'needs-auth' });
        return;
      }
      const list = await listUpcomingPrimaryEvents(uid, token);
      setEvents(list);
      setState({ kind: 'ready' });
    } catch (err) {
      if (err instanceof CalendarAuthError) {
        setState({ kind: 'needs-auth' });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }, [uid]);

  useEffect(() => {
    if (getCachedCalendarToken(uid)) {
      load(false);
    } else {
      setState({ kind: 'needs-auth' });
    }
  }, [uid, load]);

  async function handleConnect() {
    try {
      await grantCalendarAccess(uid);
      await load(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }

  function handleDisconnect() {
    clearCalendarToken();
    setEvents([]);
    setState({ kind: 'needs-auth' });
  }

  async function handleCreated(event: CalendarEvent) {
    setShowForm(false);
    // Insere no lugar certo (lista é ordenada por data crescente).
    setEvents((prev) => {
      const next = [...prev, event];
      next.sort((a, b) => a.startDate.localeCompare(b.startDate));
      return next;
    });
  }

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [events]);

  return (
    <section className="countdown-view">
      {state.kind === 'needs-auth' && (
        <div className="countdown-connect">
          <p className="muted">
            Conecte sua conta Google para sincronizar os eventos do seu
            calendário e ver a contagem regressiva.
          </p>
          <button type="button" className="btn-primary" onClick={handleConnect}>
            Conectar Google Calendar
          </button>
        </div>
      )}

      {state.kind === 'loading' && (
        <p className="muted countdown-status">Carregando eventos…</p>
      )}

      {state.kind === 'error' && (
        <div className="countdown-error" role="alert">
          <p className="error">{state.message}</p>
          <button type="button" className="link-btn" onClick={() => load(true)}>
            Tentar novamente
          </button>
        </div>
      )}

      {state.kind === 'ready' && sortedEvents.length === 0 && (
        <p className="muted countdown-status">
          Nenhum evento nos próximos 12 meses.
        </p>
      )}

      {state.kind === 'ready' && sortedEvents.length > 0 && (
        <>
          <div className="countdown-list">
            {sortedEvents.map((event) => {
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
                    {label && (
                      <span className="countdown-card-label">{label}</span>
                    )}
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

          <div className="countdown-actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => load(true)}
            >
              Atualizar
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={handleDisconnect}
            >
              Desconectar Google Calendar
            </button>
          </div>
        </>
      )}

      {state.kind !== 'needs-auth' && state.kind !== 'error' && (
        <button
          type="button"
          className="fab"
          onClick={() => setShowForm(true)}
          aria-label="adicionar contagem regressiva"
          title="adicionar contagem regressiva"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 3v14M3 10h14"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}

      {showForm && (
        <NewCountdownForm
          uid={uid}
          onClose={() => setShowForm(false)}
          onCreated={handleCreated}
          onNeedsAuth={() => {
            setShowForm(false);
            setState({ kind: 'needs-auth' });
          }}
        />
      )}
    </section>
  );
}

function NewCountdownForm({
  uid,
  onClose,
  onCreated,
  onNeedsAuth,
}: {
  uid: string;
  onClose: () => void;
  onCreated: (event: CalendarEvent) => void;
  onNeedsAuth: () => void;
}) {
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = summary.trim();
    if (!trimmed) {
      setError('Dê um título à contagem.');
      return;
    }
    if (!date) {
      setError('Escolha uma data.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await ensureCalendarToken(uid);
      const event = await createPrimaryEvent(uid, token, {
        summary: trimmed,
        date,
        time: time || undefined,
      });
      onCreated(event);
    } catch (err) {
      if (err instanceof CalendarAuthError) {
        onNeedsAuth();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form className="modal countdown-form" onSubmit={handleSubmit}>
        <h2 className="modal-title">Nova contagem regressiva</h2>
        <p className="muted modal-subtitle">
          O evento será criado no seu Google Calendar (calendário principal).
        </p>

        <label className="modal-field">
          <span>Título</span>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            autoFocus
            disabled={submitting}
            placeholder="Ex.: Casamento Guigui"
          />
        </label>

        <label className="modal-field">
          <span>Data</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={submitting}
            required
          />
        </label>

        <label className="modal-field">
          <span>
            Horário <span className="muted">(opcional)</span>
          </span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={submitting}
          />
        </label>

        {error && (
          <p className="error modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="link-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Criando…' : 'Criar evento'}
          </button>
        </div>
      </form>
    </div>
  );
}
