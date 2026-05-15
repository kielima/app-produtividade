import { useMemo, useState } from 'react';
import { TaskCard } from '../components/TaskCard';
import { calcScore, isTaskBlocked } from '../lib/score';
import type { Modo, ScoreContext, Section, Task } from '../types';

const MODO_LABEL: Record<Modo, string> = {
  manual: 'Manual',
  colaborar: 'Colaborar',
  delegar: 'Delegar',
  automatizar: 'Automatizar',
  '': '—',
};

const MODO_VALUES: Modo[] = ['manual', 'colaborar', 'delegar', 'automatizar', ''];

/**
 * Lista única ordenada por score descendente. Tarefas com score 0 (Won't
 * ou bloqueadas) ficam no fim. Não há D&D — a ordem é derivada dos campos
 * (MoSCoW, esforço, prazo, etc.); para mudar a prioridade o usuário edita
 * os badges no próprio card.
 */
export function PrioridadeView({
  uid,
  tasks,
  sections,
  sectionMap,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  sections: Section[];
  sectionMap: Record<string, Section>;
  ctx: ScoreContext;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [sectionFilter, setSectionFilter] = useState<string>(''); // '' = todas
  const [modoFilter, setModoFilter] = useState<Set<Modo>>(
    () => new Set<Modo>(MODO_VALUES),
  );

  function toggleModo(m: Modo) {
    setModoFilter((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  function clearFilters() {
    setHideZero(true);
    setHideCompleted(true);
    setSectionFilter('');
    setModoFilter(new Set(MODO_VALUES));
  }

  const activeFilterCount =
    (hideZero ? 0 : 1) +
    (hideCompleted ? 0 : 1) +
    (sectionFilter ? 1 : 0) +
    (modoFilter.size === MODO_VALUES.length ? 0 : 1);

  const scored = useMemo(() => {
    return tasks
      .filter((t) => (hideCompleted ? !t.checked : true))
      .filter((t) => (sectionFilter ? t.section === sectionFilter : true))
      .filter((t) => modoFilter.has(t.modo))
      .map((t) => ({
        task: t,
        score: calcScore(t, sectionMap[t.section] ?? null, ctx),
      }))
      .filter((x) => (hideZero ? x.score > 0 : true))
      .sort((a, b) => b.score - a.score);
  }, [tasks, sectionMap, ctx, hideZero, hideCompleted, sectionFilter, modoFilter]);

  return (
    <section className="prioridade-view">
      <header className="filters">
        <button
          type="button"
          className="btn-secondary filters-toggle"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          🔽 Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <span className="counter">{scored.length} tarefas</span>
      </header>

      {filtersOpen && (
        <div className="filters-panel" role="region" aria-label="filtros">
          <fieldset>
            <legend>Ocultar</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={hideZero}
                onChange={(e) => setHideZero(e.target.checked)}
              />
              &nbsp;score 0
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={hideCompleted}
                onChange={(e) => setHideCompleted(e.target.checked)}
              />
              &nbsp;concluídas
            </label>
          </fieldset>

          <fieldset>
            <legend>Projeto / Seção</legend>
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="filter-select"
            >
              <option value="">Todos</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset>
            <legend>Modo</legend>
            <div className="chip-group">
              {MODO_VALUES.map((m) => (
                <button
                  key={m || 'empty'}
                  type="button"
                  className={`chip${modoFilter.has(m) ? ' active' : ''}`}
                  onClick={() => toggleModo(m)}
                  aria-pressed={modoFilter.has(m)}
                >
                  {MODO_LABEL[m]}
                </button>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            className="btn-link"
            onClick={clearFilters}
            disabled={activeFilterCount === 0}
          >
            limpar filtros
          </button>
        </div>
      )}

      <div className="task-list prioridade-list">
        {scored.map(({ task, score }) => (
          <TaskCard
            key={task.id}
            uid={uid}
            task={task}
            blocked={isTaskBlocked(task, ctx)}
            sections={sections}
            allTasks={tasks}
            score={score}
          />
        ))}
        {scored.length === 0 && <p className="muted">Nenhuma tarefa.</p>}
      </div>
    </section>
  );
}
