import { useEffect, useMemo, useRef, useState } from 'react';
import Confetti from '../components/Confetti';
import TrashIcon from '../components/TrashIcon';
import { hapticCelebrate, hapticSuccess, hapticTap } from '../lib/haptics';
import { getDisplayTitle } from '../lib/parser';
import { orphanChildren, patchTask } from '../lib/taskMutations';
import { getChildren } from '../lib/taskHierarchy';
import { deleteTask } from '../repositories/tasksRepo';
import type { Esforco, MoSCoW, Project, Task } from '../types';

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
  // Subtarefas (filhas) ficam ocultas e são classificadas na sua própria página.
  return !t.checked && !t.parentId && (t.moscow === '' || t.esforco === '');
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
  projects,
  onClose,
}: {
  uid: string;
  tasks: Task[];
  projects: Project[];
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
  // Incrementa a cada classificação concluída pra re-disparar a animação de
  // recompensa (a barra pulsa). Usado como `key` no elemento de brilho.
  const [rewardPulse, setRewardPulse] = useState(0);
  const initialTotalRef = useRef(0);

  // Dispara o reforço positivo: vibração + animação na barra de progresso.
  function triggerReward() {
    hapticSuccess();
    setRewardPulse((n) => n + 1);
  }

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

  const projectNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projects) m[p.id] = p.name;
    return m;
  }, [projects]);

  const currentTask = index < queue.length ? taskById[queue[index]] ?? null : null;
  const currentProjectName = currentTask
    ? projectNameById[currentTask.section] ?? null
    : null;

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
        triggerReward();
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
    hapticTap();
    advance();
  }

  function handlePrev() {
    if (busy || index === 0) return;
    hapticTap();
    setIndex((i) => Math.max(0, i - 1));
  }

  async function handleMarkDone() {
    if (!currentTask || busy) return;
    setBusy(true);
    try {
      await patchTask(uid, currentTask, { checked: true });
      setClassifiedCount((c) => c + 1);
      triggerReward();
      advance();
    } catch (err) {
      console.error('Falha ao marcar como concluída', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!currentTask || busy) return;
    const display = getDisplayTitle(currentTask.title);
    const children = getChildren(currentTask.id, tasks);
    const msg =
      children.length > 0
        ? `Apagar "${display}"? As ${children.length} subtarefa(s) voltarão a ser tarefas normais.`
        : `Apagar "${display}"?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      if (children.length > 0) await orphanChildren(uid, currentTask.id, tasks);
      await deleteTask(uid, currentTask);
      advance();
    } catch (err) {
      console.error('Falha ao apagar tarefa', err);
    } finally {
      setBusy(false);
    }
  }

  const total = initialTotalRef.current;
  const done = index >= queue.length && queue.length > 0;
  const empty = queue.length === 0;
  const progressPct = total > 0 ? Math.round((classifiedCount / total) * 100) : 0;

  // Comemora com vibração mais longa quando a sessão termina. E, se TODAS as
  // tarefas da fila foram classificadas (100%, sem pulos), solta confetes.
  const allClassified = total > 0 && classifiedCount >= total;
  const [showConfetti, setShowConfetti] = useState(false);
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (done && !celebratedRef.current) {
      celebratedRef.current = true;
      hapticCelebrate();
      if (allClassified) setShowConfetti(true);
    }
  }, [done, allClassified]);

  return (
    <section className="classify-view">
      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}
      <ClassifyTopbar
        current={done ? total : Math.min(index + 1, total)}
        total={total}
        onClose={onClose}
        showCount={!empty}
      />

      {!empty && (
        <div
          className="classify-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          aria-label="progresso da classificação"
        >
          <div className="classify-progress-track">
            <div
              className="classify-progress-fill"
              style={{ width: `${progressPct}%` }}
            >
              {rewardPulse > 0 && (
                <span key={rewardPulse} className="classify-progress-spark" aria-hidden="true" />
              )}
            </div>
          </div>
          <span className="classify-progress-label">
            {classifiedCount} de {total} classificada{total === 1 ? '' : 's'} · {progressPct}%
          </span>
        </div>
      )}

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
          {currentProjectName && (
            <p className="classify-project" aria-label="projeto da tarefa">
              <span className="classify-project-label">Projeto:</span>{' '}
              <span className="classify-project-name">{currentProjectName}</span>
            </p>
          )}

          <div className="classify-done-row">
            <label className="classify-done-toggle">
              <input
                type="checkbox"
                checked={false}
                onChange={handleMarkDone}
                disabled={busy}
              />
              <span>marcar como concluída</span>
            </label>
            <button
              type="button"
              className="classify-delete"
              onClick={handleDelete}
              disabled={busy}
              aria-label="apagar tarefa"
              title="apagar tarefa"
            >
              <TrashIcon size={18} />
            </button>
          </div>

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
