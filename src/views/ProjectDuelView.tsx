import { useEffect, useMemo, useRef, useState } from 'react';
import { pickNextPair, reorderByRating, type Pair } from '../lib/duelPairing';
import { DEFAULT_RATING, type GlickoRating } from '../lib/glicko2';
import { reorderProjects } from '../repositories/projectsRepo';
import {
  recordDuelAndPersist,
  subscribeToGlickoRatings,
  type GlickoMap,
} from '../repositories/glickoRepo';
import type { Project } from '../types';

const INACTIVE_STATUSES = new Set(['Concluído', 'Cancelado']);

export function ProjectDuelView({
  uid,
  projects,
  onClose,
}: {
  uid: string;
  projects: Project[];
  onClose: () => void;
}) {
  const [ratings, setRatings] = useState<GlickoMap>({});
  const [duelCount, setDuelCount] = useState(0);
  const [pair, setPair] = useState<Pair | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const lastPairRef = useRef<Pair | null>(null);

  useEffect(() => {
    const unsub = subscribeToGlickoRatings(uid, setRatings);
    return () => unsub();
  }, [uid]);

  const activeProjects = useMemo(
    () => projects.filter((p) => !INACTIVE_STATUSES.has(p.status)),
    [projects],
  );
  const activeIds = useMemo(() => activeProjects.map((p) => p.id), [activeProjects]);
  const projectById = useMemo(() => {
    const m: Record<string, Project> = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  const generateNextPair = () => {
    const next = pickNextPair({
      candidateIds: activeIds,
      ratings,
      lastPair: lastPairRef.current,
    });
    setPair(next);
  };

  useEffect(() => {
    if (!pair && activeIds.length >= 2) generateNextPair();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds.length, pair]);

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
  };
  useEffect(() => {
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePick(winnerId: string) {
    if (!pair || busy) return;
    const loserId = pair[0] === winnerId ? pair[1] : pair[0];
    const winnerRating = ratings[winnerId] ?? { ...DEFAULT_RATING };
    const loserRating = ratings[loserId] ?? { ...DEFAULT_RATING };
    setBusy(true);
    try {
      await recordDuelAndPersist(uid, winnerId, winnerRating, loserId, loserRating);
      lastPairRef.current = pair;
      setDuelCount((n) => n + 1);
      setPair(null); // dispara o useEffect pra sortear o próximo
    } catch (err) {
      console.error('Falha ao registrar duelo', err);
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    lastPairRef.current = pair;
    setPair(null);
    generateNextPair();
  }

  async function handleClose() {
    if (closing) return;
    setClosing(true);
    try {
      if (duelCount > 0) {
        const allIds = projects.map((p) => p.id);
        const activeSet = new Set(activeIds);
        const newOrder = reorderByRating(allIds, activeSet, ratings);
        await reorderProjects(uid, newOrder);
      }
    } catch (err) {
      console.error('Falha ao aplicar nova ordem', err);
    } finally {
      onClose();
    }
  }

  if (activeIds.length < 2) {
    return (
      <section className="duel-view">
        <header className="duel-topbar">
          <button
            type="button"
            className="duel-close"
            onClick={handleClose}
            aria-label="encerrar duelos"
          >
            ✕
          </button>
        </header>
        <div className="duel-empty">
          <p>É preciso ter ao menos 2 projetos ativos para duelar.</p>
        </div>
      </section>
    );
  }

  const a = pair ? projectById[pair[0]] : null;
  const b = pair ? projectById[pair[1]] : null;

  return (
    <section className="duel-view">
      <header className="duel-topbar">
        <button
          type="button"
          className="duel-close"
          onClick={handleClose}
          aria-label="encerrar duelos"
          disabled={closing}
        >
          ✕
        </button>
        <span className="duel-count" aria-live="polite">
          {duelCount} duelo{duelCount === 1 ? '' : 's'}
        </span>
      </header>

      <p className="duel-prompt">Qual é mais prioritário?</p>

      {a && b ? (
        <div className="duel-cards">
          <DuelCard
            project={a}
            rating={ratings[a.id]}
            onPick={() => handlePick(a.id)}
            disabled={busy}
          />
          <div className="duel-vs" aria-hidden="true">
            vs
          </div>
          <DuelCard
            project={b}
            rating={ratings[b.id]}
            onPick={() => handlePick(b.id)}
            disabled={busy}
          />
        </div>
      ) : (
        <p className="muted duel-loading">Sorteando próximo duelo…</p>
      )}

      <div className="duel-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={handleSkip}
          disabled={busy || !pair}
        >
          pular este par
        </button>
      </div>
    </section>
  );
}

function DuelCard({
  project,
  rating,
  onPick,
  disabled,
}: {
  project: Project;
  rating: GlickoRating | undefined;
  onPick: () => void;
  disabled: boolean;
}) {
  const effective = rating ?? DEFAULT_RATING;
  return (
    <button
      type="button"
      className="duel-card"
      onClick={onPick}
      disabled={disabled}
      aria-label={`escolher ${project.name}`}
    >
      <span className="duel-card-name">{project.name}</span>
      <span className="duel-card-rating">
        {Math.round(effective.r)} ± {Math.round(effective.rd)}
      </span>
    </button>
  );
}
