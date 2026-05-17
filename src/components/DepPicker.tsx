import { useEffect, useMemo, useState } from 'react';
import { getDisplayTitle } from '../lib/parser';
import type { Task } from '../types';

/**
 * Modal pra adicionar/remover dependências de uma tarefa.
 * As deps são armazenadas como strings no formato `#NNNN` (taskId zero-padded).
 */
export function DepPicker({
  task,
  allTasks,
  onClose,
  onChange,
}: {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onChange: (newDeps: string[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const [deps, setDeps] = useState<string[]>(task.dependsOn);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return allTasks
      .filter((t) => t.id !== task.id && t.taskId != null && !t.checked)
      .filter((t) => {
        if (!q) return true;
        return getDisplayTitle(t.title).toLowerCase().includes(q);
      })
      .sort((a, b) => (a.taskId ?? 0) - (b.taskId ?? 0));
  }, [allTasks, task.id, filter]);

  const resolveLabel = (dep: string): string => {
    const m = dep.trim().match(/^#(\d+)$/);
    if (m) {
      const other = allTasks.find((t) => t.taskId === parseInt(m[1]!, 10));
      if (other) return `${dep} — ${getDisplayTitle(other.title)}`;
    }
    return dep;
  };

  function addDep(other: Task) {
    if (other.taskId == null) return;
    const tag = `#${String(other.taskId).padStart(4, '0')}`;
    if (deps.includes(tag)) return;
    const next = [...deps, tag];
    setDeps(next);
    onChange(next);
  }

  function removeDep(dep: string) {
    const next = deps.filter((d) => d !== dep);
    setDeps(next);
    onChange(next);
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h3>Dependências de “{getDisplayTitle(task.title)}”</h3>
          <button
            onClick={onClose}
            className="icon-btn"
            style={{ fontSize: '24px' }}
            aria-label="fechar"
          >
            ×
          </button>
        </header>

        <section className="cur-deps">
          <h4>Atuais</h4>
          {deps.length === 0 ? (
            <p className="muted">Sem dependências.</p>
          ) : (
            <ul>
              {deps.map((d) => (
                <li key={d}>
                  <span>{resolveLabel(d)}</span>
                  <button
                    onClick={() => removeDep(d)}
                    className="icon-btn"
                    style={{ fontSize: '24px' }}
                    aria-label="remover"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="add-dep">
          <h4>Adicionar</h4>
          <input
            type="text"
            placeholder="Filtrar tarefas…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="inline-edit-input"
            autoFocus
          />
          <ul className="candidate-list">
            {candidates.slice(0, 50).map((t) => {
              const tag = `#${String(t.taskId).padStart(4, '0')}`;
              const already = deps.includes(tag);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => addDep(t)}
                    disabled={already}
                    className="dep-candidate"
                  >
                    <span className="dep-tag">{tag}</span>
                    <span>{getDisplayTitle(t.title)}</span>
                    {already && <span className="muted">(já)</span>}
                  </button>
                </li>
              );
            })}
            {candidates.length === 0 && <li className="muted">Nada encontrado.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
