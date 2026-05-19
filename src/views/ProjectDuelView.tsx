import { useEffect, useMemo, useRef, useState } from 'react';
import {
  pickNextPair,
  recommendedDuelLimit,
  reorderByRating,
  summarizeChanges,
  type DuelSummary,
  type Pair,
} from '../lib/duelPairing';
import {
  classifyConfidence,
  classifyVolatility,
  DEFAULT_RATING,
  type GlickoRating,
} from '../lib/glicko2';
import { reorderProjects } from '../repositories/projectsRepo';
import {
  recordDuelAndPersist,
  revertDuelAndPersist,
  subscribeToGlickoRatings,
  type GlickoMap,
} from '../repositories/glickoRepo';
import type { Project } from '../types';

const INACTIVE_STATUSES = new Set(['Concluído', 'Cancelado']);

type Phase = 'dueling' | 'summary';

type UndoSnapshot = {
  pair: Pair;
  winnerId: string;
  loserId: string;
  winnerRatingBefore: GlickoRating;
  loserRatingBefore: GlickoRating;
  prevLastPair: Pair | null;
};

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
  const [phase, setPhase] = useState<Phase>('dueling');
  const [summary, setSummary] = useState<DuelSummary | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  /** Limite recalculado enquanto nenhum duelo aconteceu; congela após o 1º. */
  const [limit, setLimit] = useState(0);
  const lastPairRef = useRef<Pair | null>(null);
  /** Snapshot dos ativos no momento em que a sessão começa — base do diff final. */
  const initialOrderRef = useRef<string[] | null>(null);

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

  // Captura o snapshot inicial + limite. O limite continua sendo recalculado
  // enquanto nenhum duelo aconteceu pra acomodar o snapshot de ratings que
  // chega via listener depois do primeiro render. Após o 1º duelo, congela.
  useEffect(() => {
    if (duelCount > 0) return;
    if (activeIds.length < 2) return;
    if (initialOrderRef.current === null) {
      initialOrderRef.current = [...activeIds];
    }
    setLimit(recommendedDuelLimit(activeIds, ratings));
  }, [activeIds, ratings, duelCount]);

  const generateNextPair = () => {
    const next = pickNextPair({
      candidateIds: activeIds,
      ratings,
      lastPair: lastPairRef.current,
    });
    setPair(next);
  };

  useEffect(() => {
    if (phase !== 'dueling') return;
    if (!pair && activeIds.length >= 2) generateNextPair();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds.length, pair, phase]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePick(winnerId: string) {
    if (!pair || busy || phase !== 'dueling') return;
    const loserId = pair[0] === winnerId ? pair[1] : pair[0];
    const winnerRating = ratings[winnerId] ?? { ...DEFAULT_RATING };
    const loserRating = ratings[loserId] ?? { ...DEFAULT_RATING };
    const pickedPair = pair;
    const prevLastPair = lastPairRef.current;
    setBusy(true);
    try {
      const result = await recordDuelAndPersist(
        uid,
        winnerId,
        winnerRating,
        loserId,
        loserRating,
      );
      lastPairRef.current = pickedPair;
      const nextCount = duelCount + 1;
      setDuelCount(nextCount);
      setPair(null);
      setUndoSnapshot({
        pair: pickedPair,
        winnerId,
        loserId,
        winnerRatingBefore: winnerRating,
        loserRatingBefore: loserRating,
        prevLastPair,
      });
      if (nextCount >= limit) {
        // Usa os ratings recém-aplicados (snapshot ainda não chegou via listener).
        const mergedRatings: GlickoMap = {
          ...ratings,
          [winnerId]: result.winner,
          [loserId]: result.loser,
        };
        const newOrder = reorderByRating(
          projects.map((p) => p.id),
          new Set(activeIds),
          mergedRatings,
        );
        setSummary(
          summarizeChanges(initialOrderRef.current ?? activeIds, newOrder),
        );
        setPhase('summary');
      }
    } catch (err) {
      console.error('Falha ao registrar duelo', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (!undoSnapshot || busy) return;
    setBusy(true);
    try {
      await revertDuelAndPersist(
        uid,
        undoSnapshot.winnerId,
        undoSnapshot.winnerRatingBefore,
        undoSnapshot.loserId,
        undoSnapshot.loserRatingBefore,
      );
      lastPairRef.current = undoSnapshot.prevLastPair;
      setDuelCount((c) => Math.max(0, c - 1));
      setPair(undoSnapshot.pair);
      setSummary(null);
      setPhase('dueling');
      setUndoSnapshot(null);
    } catch (err) {
      console.error('Falha ao desfazer duelo', err);
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    if (phase !== 'dueling') return;
    lastPairRef.current = pair;
    setPair(null);
    setUndoSnapshot(null);
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
        <DuelTopbar
          duelCount={duelCount}
          limit={limit}
          onClose={handleClose}
          closing={closing}
          showCount={false}
        />
        <div className="duel-empty">
          <p>É preciso ter ao menos 2 projetos ativos para duelar.</p>
        </div>
      </section>
    );
  }

  if (phase === 'summary' && summary) {
    return (
      <section className="duel-view">
        <DuelTopbar
          duelCount={duelCount}
          limit={limit}
          onClose={handleClose}
          closing={closing}
        />
        <DuelSummaryView
          summary={summary}
          duelCount={duelCount}
          projectById={projectById}
          onClose={handleClose}
          closing={closing}
          onUndo={undoSnapshot ? handleUndo : undefined}
          undoing={busy}
        />
      </section>
    );
  }

  const a = pair ? projectById[pair[0]] : null;
  const b = pair ? projectById[pair[1]] : null;

  return (
    <section className="duel-view">
      <DuelTopbar
        duelCount={duelCount}
        limit={limit}
        onClose={handleClose}
        closing={closing}
      />

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
        {undoSnapshot && (
          <button
            type="button"
            className="btn-secondary"
            onClick={handleUndo}
            disabled={busy}
            aria-label="desfazer último duelo"
          >
            desfazer
          </button>
        )}
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

function DuelTopbar({
  duelCount,
  limit,
  onClose,
  closing,
  showCount = true,
}: {
  duelCount: number;
  limit: number;
  onClose: () => void;
  closing: boolean;
  showCount?: boolean;
}) {
  return (
    <header className="duel-topbar">
      <button
        type="button"
        className="duel-close"
        onClick={onClose}
        aria-label="encerrar duelos"
        disabled={closing}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {showCount && limit > 0 && (
        <span className="duel-count" aria-live="polite">
          {duelCount} / {limit}
        </span>
      )}
    </header>
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
  const volLevel = classifyVolatility(effective.sigma);
  const confLevel = classifyConfidence(effective.rd);
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
      <span
        className={`duel-card-badge duel-card-badge--${volLevel}`}
        title={`σ=${effective.sigma.toFixed(3)}`}
      >
        {volLevel} volatilidade
      </span>
      <span
        className={`duel-card-badge duel-card-badge--${confLevel}-conf`}
        title={`RD=${Math.round(effective.rd)}`}
      >
        {confLevel} confiança
      </span>
    </button>
  );
}

function DuelSummaryView({
  summary,
  duelCount,
  projectById,
  onClose,
  closing,
  onUndo,
  undoing,
}: {
  summary: DuelSummary;
  duelCount: number;
  projectById: Record<string, Project>;
  onClose: () => void;
  closing: boolean;
  onUndo?: () => void;
  undoing: boolean;
}) {
  const nameOf = (id: string) => projectById[id]?.name ?? id;
  const nothingMoved = summary.risers.length === 0 && summary.fallers.length === 0;

  return (
    <div className="duel-summary">
      <h2 className="duel-summary-title">Sessão concluída</h2>
      <p className="duel-summary-sub">
        {duelCount} duelo{duelCount === 1 ? '' : 's'} realizado{duelCount === 1 ? '' : 's'}.
      </p>

      {nothingMoved && (
        <p className="muted duel-summary-empty">
          A ordem da lista não mudou.
        </p>
      )}

      {summary.risers.length > 0 && (
        <section className="duel-summary-section">
          <h3>Subiram</h3>
          <ul>
            {summary.risers.map((r) => (
              <li key={r.id}>
                <span className="duel-summary-name">{nameOf(r.id)}</span>
                <span className="duel-summary-delta up">
                  +{r.delta} posição{r.delta === 1 ? '' : 'es'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.fallers.length > 0 && (
        <section className="duel-summary-section">
          <h3>Desceram</h3>
          <ul>
            {summary.fallers.map((f) => (
              <li key={f.id}>
                <span className="duel-summary-name">{nameOf(f.id)}</span>
                <span className="duel-summary-delta down">
                  {f.delta} posição{f.delta === -1 ? '' : 'es'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.newTop.length > 0 && (
        <section className="duel-summary-section">
          <h3>Nova Top {summary.newTop.length}</h3>
          <ol className="duel-summary-top">
            {summary.newTop.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ol>
        </section>
      )}

      <div className="duel-actions">
        {onUndo && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onUndo}
            disabled={undoing || closing}
            aria-label="desfazer último duelo"
          >
            desfazer último
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={onClose}
          disabled={closing}
        >
          {closing ? 'aplicando…' : 'voltar para a lista'}
        </button>
      </div>
    </div>
  );
}
