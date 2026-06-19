import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applySessionDuels,
  pickNextPair,
  recommendedDuelLimit,
  reorderByRating,
  summarizeChanges,
  type DuelResult,
  type DuelSummary,
  type Pair,
} from '../lib/duelPairing';
import {
  classifyConfidence,
  classifyVolatility,
  computeVolatilityBands,
  DEFAULT_RATING,
  type GlickoRating,
  type VolatilityBands,
} from '../lib/glicko2';
import { reorderProjects } from '../repositories/projectsRepo';
import {
  persistRatings,
  subscribeToGlickoRatings,
  type GlickoMap,
} from '../repositories/glickoRepo';
import type { Project } from '../types';

const INACTIVE_STATUSES = new Set(['Concluído', 'Cancelado']);

type Phase = 'dueling' | 'summary';

/**
 * Registro de um duelo da sessão. NÃO persistimos cada duelo: a sessão
 * inteira é tratada como UM rating period do Glicko-2, aplicado de uma vez
 * ao fechar (ver `applySessionDuels`). Guardado em ref porque o resultado é
 * derivado dele + dos ratings do início da sessão. Desfazer = remover o
 * último registro; nada toca o Firestore até o fim.
 */
type LoggedDuel = {
  pair: Pair;
  winnerId: string;
  loserId: string;
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
  const [closing, setClosing] = useState(false);
  const [phase, setPhase] = useState<Phase>('dueling');
  const [summary, setSummary] = useState<DuelSummary | null>(null);
  /** Limite recalculado enquanto nenhum duelo aconteceu; congela após o 1º. */
  const [limit, setLimit] = useState(0);
  const lastPairRef = useRef<Pair | null>(null);
  /** Snapshot dos ativos no momento em que a sessão começa — base do diff final. */
  const initialOrderRef = useRef<string[] | null>(null);
  /** Log da sessão; aplicado como um único rating period ao fechar. */
  const matchLogRef = useRef<LoggedDuel[]>([]);

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

  // Bandas adaptativas para o badge de volatilidade dos cards (ver
  // `computeVolatilityBands`). Como nada é persistido no meio da sessão,
  // `ratings` permanece no estado do início — o período-base do Glicko-2.
  const volatilityBands = useMemo(
    () => computeVolatilityBands(Object.values(ratings).map((r) => r.sigma)),
    [ratings],
  );

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

  /**
   * Ratings finais projetados a partir do log atual, tratando a sessão como
   * UM rating period. Retorna o mapa completo (início + participantes
   * recalculados) para alimentar a reordenação/summary.
   */
  function projectFinalRatings(): GlickoMap {
    const results: DuelResult[] = matchLogRef.current.map((d) => ({
      winnerId: d.winnerId,
      loserId: d.loserId,
    }));
    return { ...ratings, ...applySessionDuels(ratings, results) };
  }

  function handlePick(winnerId: string) {
    if (!pair || closing || phase !== 'dueling') return;
    const loserId = pair[0] === winnerId ? pair[1] : pair[0];
    matchLogRef.current = [
      ...matchLogRef.current,
      { pair, winnerId, loserId, prevLastPair: lastPairRef.current },
    ];
    lastPairRef.current = pair;
    const nextCount = duelCount + 1;
    setDuelCount(nextCount);
    setPair(null);
    if (nextCount >= limit) {
      const newOrder = reorderByRating(
        projects.map((p) => p.id),
        new Set(activeIds),
        projectFinalRatings(),
      );
      setSummary(
        summarizeChanges(initialOrderRef.current ?? activeIds, newOrder),
      );
      setPhase('summary');
    }
  }

  function handleUndo() {
    const log = matchLogRef.current;
    if (log.length === 0 || closing) return;
    const last = log[log.length - 1]!;
    matchLogRef.current = log.slice(0, -1);
    lastPairRef.current = last.prevLastPair;
    setDuelCount((c) => Math.max(0, c - 1));
    setPair(last.pair);
    setSummary(null);
    setPhase('dueling');
  }

  function handleSkip() {
    if (phase !== 'dueling') return;
    lastPairRef.current = pair;
    setPair(null);
    generateNextPair();
  }

  async function handleClose() {
    if (closing) return;
    setClosing(true);
    try {
      if (matchLogRef.current.length > 0) {
        const results: DuelResult[] = matchLogRef.current.map((d) => ({
          winnerId: d.winnerId,
          loserId: d.loserId,
        }));
        const changed = applySessionDuels(ratings, results);
        const newOrder = reorderByRating(
          projects.map((p) => p.id),
          new Set(activeIds),
          { ...ratings, ...changed },
        );
        await persistRatings(uid, changed);
        await reorderProjects(uid, newOrder);
      }
    } catch (err) {
      console.error('Falha ao aplicar a sessão de duelos', err);
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
          onUndo={duelCount > 0 ? handleUndo : undefined}
          undoing={closing}
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
            bands={volatilityBands}
            onPick={() => handlePick(a.id)}
            disabled={closing}
          />
          <div className="duel-vs" aria-hidden="true">
            vs
          </div>
          <DuelCard
            project={b}
            rating={ratings[b.id]}
            bands={volatilityBands}
            onPick={() => handlePick(b.id)}
            disabled={closing}
          />
        </div>
      ) : (
        <p className="muted duel-loading">Sorteando próximo duelo…</p>
      )}

      <div className="duel-actions">
        {duelCount > 0 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={handleUndo}
            disabled={closing}
            aria-label="desfazer último duelo"
          >
            desfazer
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={handleSkip}
          disabled={closing || !pair}
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
  bands,
  onPick,
  disabled,
}: {
  project: Project;
  rating: GlickoRating | undefined;
  bands: VolatilityBands;
  onPick: () => void;
  disabled: boolean;
}) {
  const effective = rating ?? DEFAULT_RATING;
  const volLevel = classifyVolatility(effective.sigma, bands);
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
