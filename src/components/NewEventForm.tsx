import { useEffect, useState } from 'react';
import {
  CalendarAuthError,
  createPrimaryEvent,
  ensureCalendarToken,
  type CalendarEvent,
} from '../lib/googleCalendar';

export function NewEventForm({
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
