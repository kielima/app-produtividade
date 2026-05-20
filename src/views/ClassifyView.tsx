import { useEffect, useMemo, useRef, useState } from 'react';
import { getDisplayTitle } from '../lib/parser';
import { patchTask } from '../lib/taskMutations';
import type { Esforco, MoSCoW, Task } from '../types';

const MOSCOW_OPTIONS: Array<{ key: Exclude<MoSCoW, ''>; label: string }> = [
  { key: 'must', label: 'Must' },
  { key: 'should', label: 'Should' },
  { key: 'could', label: 'Could' },
  { key: 'wont', label: "Won't" },
];

const ESFORCO_OPTIONS: Array<{ key: Exclude<Esforco, ''>; label: string }> = [
  { key: 'rapido', label: 'Rápido' },
  { key: 'medio', label: 'Médio' },
  { key: 'longo', label: 'Longo' },
];

function needsClassification(t: Task): boolean {
  return !t.checked && (t.moscow === '' || t.esforco === '');
}

/**
 * Modo de classificação rápida: mostra um card por vez com tarefas que estão
 * sem MoSCoW ou sem Esforço, e deixa o usuário preencher os dois campos como
 * um joguinho. A fila é congelada no mount pra evitar reordenação durante o
 * fluxo — itens já classificados ficam na fila como "concluídos" mas não
 * aparecem mais.
 */
export function ClassifyView({
  uid,
  tasks,
  onClose,
}: {
  uid: string;
  tasks: Task[];
  onClose: () => void;
}) {
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  // Seleções locais otimistas; sobrescrevem os valores do task até a
  // persistência terminar e o listener atualizar `tasks`.
  const [pendingMoscow, setPendingMoscow] = useState<MoSCoW | null>(null);
  const [pendingEsforco, setPendingEsforco] = useState<Esforco | null>(null);
  const [busy, setBusy] = useState(false);
  const [classifiedCount, setClassifiedCount] = useState(0);
  const initialTotalRef = useRef(0);

  // Captura snapshot da fila no mount. Não reage a mudanças no `tasks` pra
  // não embaralhar a ordem enquanto o usuário classifica.
  useEffect(() => {
    const ids = tasks.filter(needsClassification).map((t) => t.id);
    setQueue(ids);
    initialTotalRef.current = ids.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taskById = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  const currentTask = index < queue.length ? taskById[queue[index]] ?? null : null;

  // Reseta o pending quando o item atual muda.
  useEffect(() => {
    setPendingMoscow(null);
    setPendingEsforco(null);
  }, [currentTask?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const effMoscow: MoSCoW = pendingMoscow ?? (currentTask?.moscow ?? '');
  const effEsforco: Esforco = pendingEsforco ?? (currentTask?.esforco ?? '');

  function advance() {
    setIndex((i) => i + 1);
  }

  async function persistAndMaybeAdvance(
    task: Task,
    nextMoscow: MoSCoW,
    nextEsforco: Esforco,
  ) {
    const willComplete = nextMoscow !== '' && nextEsforco !== '';
    setBusy(true);
    try {
      await patchTask(uid, task, { moscow: nextMoscow, esforco: nextEsforco });
      if (willComplete) {
        setClassifiedCount((c) => c + 1);
        advance();
      }
    } catch (err) {
      console.error('Falha ao classificar tarefa', err);
    } finally {
      setBusy(false);
    }
  }

  async function handlePickMoscow(m: Exclude<MoSCoW, ''>) {
    if (!currentTask || busy) return;
    setPendingMoscow(m);
    await persistAndMaybeAdvance(currentTask, m, effEsforco);
  }

  async function handlePickEsforco(e: Exclude<Esforco, ''>) {
    if (!currentTask || busy) return;
    setPendingEsforco(e);
    await persistAndMaybeAdvance(currentTask, effMoscow, e);
  }

  function handleSkip() {
    if (busy) return;
    advance();
  }

  function handlePrev() {
    if (busy || index === 0) return;
    setIndex((i) => Math.max(0, i - 1));
  }

  const total = initialTotalRef.current;
  const done = index >= queue.length && queue.length > 0;
  const empty = queue.length === 0;

  return (
    <section className="classify-view">
      <ClassifyTopbar
        current={done ? total : Math.min(index + 1, total)}
        total={total}
        onClose={onClose}
        showCount={!empty}
      />

      {empty ? (
        <div className="classify-empty">
          <p>Não há tarefas pendentes de classificação. 🎉</p>
          <button type="button" className="btn-primary" onClick={onClose}>
            voltar
          </button>
        </div>
      ) : done ? (
        <div className="classify-done">
          <h2 className="classify-done-title">Sessão concluída</h2>
          <p className="muted">
            {classifiedCount} tarefa{classifiedCount === 1 ? '' : 's'} classificada
            {classifiedCount === 1 ? '' : 's'}.
          </p>
          <button type="button" className="btn-primary" onClick={onClose}>
            voltar
          </button>
        </div>
      ) : currentTask ? (
        <div className="classify-card">
          <p className="classify-prompt">Classifique:</p>
          <h2 className="classify-title">{getDisplayTitle(currentTask.title)}</h2>

          <label className="classify-field">
            <span className="classify-field-label">MoSCoW</span>
            <select
              className="classify-select"
              value={effMoscow}
              onChange={(e) => {
                const v = e.target.value;
                if (v) handlePickMoscow(v as Exclude<MoSCoW, ''>);
              }}
              disabled={busy}
              aria-label="MoSCoW"
            >
              <option value="" disabled>
                Selecione…
              </option>
              {MOSCOW_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="classify-field">
            <span className="classify-field-label">Esforço</span>
            <select
              className="classify-select"
              value={effEsforco}
              onChange={(e) => {
                const v = e.target.value;
                if (v) handlePickEsforco(v as Exclude<Esforco, ''>);
              }}
              disabled={busy}
              aria-label="Esforço"
            >
              <option value="" disabled>
                Selecione…
              </option>
              {ESFORCO_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="classify-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handlePrev}
              disabled={busy || index === 0}
            >
              anterior
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleSkip}
              disabled={busy}
            >
              pular
            </button>
          </div>
        </div>
      ) : (
        <p className="muted classify-loading">Carregando próxima tarefa…</p>
      )}
    </section>
  );
}

function ClassifyTopbar({
  current,
  total,
  onClose,
  showCount,
}: {
  current: number;
  total: number;
  onClose: () => void;
  showCount: boolean;
}) {
  return (
    <header className="classify-topbar">
      <button
        type="button"
        className="classify-close"
        onClick={onClose}
        aria-label="encerrar classificação"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {showCount && total > 0 && (
        <span className="classify-count" aria-live="polite">
          {current} / {total}
        </span>
      )}
    </header>
  );
}
