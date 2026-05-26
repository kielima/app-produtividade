import { useEffect, useMemo } from 'react';
import { getDisplayTitle } from '../lib/parser';
import { calcScoreBreakdown } from '../lib/score';
import type { Project, ScoreContext, Task } from '../types';

const MOSCOW_LABEL: Record<string, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
  '': 'sem MoSCoW',
};

const EFFORT_LABEL: Record<string, string> = {
  rapido: 'rápido',
  medio: 'médio',
  longo: 'longo',
  '': 'sem esforço',
};

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function deadlineLabel(days: number | null): string {
  if (days === null) return 'sem prazo';
  if (days < 0) return `${Math.abs(days)} dia(s) em atraso`;
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dia(s)`;
}

export function ScoreDetailView({
  task,
  project,
  ctx,
  onClose,
}: {
  task: Task;
  project: Project | null;
  ctx: ScoreContext;
  onClose: () => void;
}) {
  const display = getDisplayTitle(task.title);
  const b = useMemo(() => calcScoreBreakdown(task, project, ctx), [task, project, ctx]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className="task-detail score-detail">
      <header className="topbar task-detail-topbar" role="banner">
        <button type="button" className="menu-toggle" onClick={onClose} aria-label="voltar">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="muted task-detail-added">Memorial de cálculo</span>
        <span className="task-detail-topbar-right">
          <span className="badge score">{fmt(b.total)}</span>
        </span>
      </header>

      <div className="task-detail-body score-detail-body">
        <h2 className="score-detail-task-title">{display}</h2>

        {b.blocked && (
          <p className="badge blocked task-detail-blocked">
            🔒 Tarefa bloqueada por {b.blockedByIds.length} dependência(s). Score forçado a 0.
          </p>
        )}
        {b.wont && (
          <p className="badge blocked task-detail-blocked">
            Tarefa marcada como Won't. Score forçado a 0.
          </p>
        )}

        <section className="score-block">
          <h3>1. Projeto</h3>
          <dl className="score-rows">
            <div>
              <dt>Rank do projeto</dt>
              <dd>{fmt(b.rankScore)}</dd>
            </div>
            <div>
              <dt>
                Bônus de prazo do projeto
                <span className="muted score-formula">
                  {' '}
                  ({deadlineLabel(b.projectDeadlineDays)})
                </span>
              </dt>
              <dd>{fmt(b.projectDeadlineBonus)}</dd>
            </div>
            <div className="score-row-sum">
              <dt>
                projectScore
                <span className="muted score-formula"> = rank + bônus prazo projeto</span>
              </dt>
              <dd>{fmt(b.projectScore)}</dd>
            </div>
          </dl>
        </section>

        <section className="score-block">
          <h3>2. Base</h3>
          <dl className="score-rows">
            <div>
              <dt>
                Pontos MoSCoW
                <span className="muted score-formula"> ({MOSCOW_LABEL[b.moscowKey]})</span>
              </dt>
              <dd>{fmt(b.moscowPts)}</dd>
            </div>
            <div>
              <dt>
                projectScore × MoSCoW
                <span className="muted score-formula">
                  {' '}
                  ({fmt(b.projectScore)} × {fmt(b.moscowPts)})
                </span>
              </dt>
              <dd>{fmt(b.projectScore * b.moscowPts)}</dd>
            </div>
            <div>
              <dt>
                Bônus subtarefas
                <span className="muted score-formula">
                  {' '}
                  ({b.subtaskBonus} por-fazer de {b.subtaskTotal})
                </span>
              </dt>
              <dd>{fmt(b.subtaskBonus)}</dd>
            </div>
            <div className="score-row-sum">
              <dt>
                base
                <span className="muted score-formula"> = projectScore × MoSCoW + subtarefas</span>
              </dt>
              <dd>{fmt(b.base)}</dd>
            </div>
          </dl>
        </section>

        <section className="score-block">
          <h3>3. Esforço</h3>
          <dl className="score-rows">
            <div>
              <dt>
                Divisor
                <span className="muted score-formula"> ({EFFORT_LABEL[b.effortKey]})</span>
              </dt>
              <dd>÷ {fmt(b.effort)}</dd>
            </div>
            <div className="score-row-sum">
              <dt>
                base / esforço
                <span className="muted score-formula">
                  {' '}
                  ({fmt(b.base)} ÷ {fmt(b.effort)})
                </span>
              </dt>
              <dd>{fmt(b.baseDivEffort)}</dd>
            </div>
          </dl>
        </section>

        <section className="score-block">
          <h3>4. Bônus adicionais</h3>
          <dl className="score-rows">
            <div>
              <dt>Em andamento</dt>
              <dd>+ {fmt(b.inProgressBonus)}</dd>
            </div>
            <div>
              <dt>
                Prazo da tarefa
                <span className="muted score-formula"> ({deadlineLabel(b.deadlineDays)})</span>
              </dt>
              <dd>+ {fmt(b.deadlineBonus)}</dd>
            </div>
            {b.deadlineDays !== null && b.deadlineDays >= 0 && (
              <div className="score-row-note muted">
                fórmula: max(0, maxOverdueScore[{fmt(b.maxOverdueScore)}] + 10 − {b.deadlineDays})
              </div>
            )}
            {b.deadlineDays !== null && b.deadlineDays < 0 && (
              <div className="score-row-note muted">
                fórmula: 5 + |{b.deadlineDays}| (tarefa atrasada)
              </div>
            )}
            <div>
              <dt>
                Idade
                <span className="muted score-formula">
                  {' '}
                  (log₂({b.ageDays} + 1)
                  {b.ageDays > 0 ? `, ${b.ageDays} dia(s)` : ''})
                </span>
              </dt>
              <dd>+ {fmt(b.ageBonus)}</dd>
            </div>
            <div>
              <dt>
                Dependências destravadas
                <span className="muted score-formula"> ({b.unlocked.length} tarefa(s))</span>
              </dt>
              <dd>+ {fmt(b.depBonus)}</dd>
            </div>
            {b.unlocked.length > 0 && (
              <div className="score-row-note">
                <ul className="score-dep-list">
                  {b.unlocked.map((u) => (
                    <li key={u.id}>
                      <span className="score-dep-title">{getDisplayTitle(u.title)}</span>
                      <span className="score-dep-pot">{fmt(u.potential)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </dl>
        </section>

        <section className="score-block score-block-total">
          <h3>5. Total</h3>
          <dl className="score-rows">
            <div className="score-row-sum">
              <dt>
                <span className="muted score-formula">
                  base/esforço + andamento + prazo + idade + dependências
                </span>
              </dt>
              <dd className="score-total-value">{fmt(b.total)}</dd>
            </div>
          </dl>
          {(b.blocked || b.wont) && (
            <p className="muted score-total-note">
              ({b.blocked ? 'bloqueada' : "Won't"} → score final = 0, ignorando o cálculo acima)
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
