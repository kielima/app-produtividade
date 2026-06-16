import { useEffect, useMemo, useState } from 'react';
import { getDisplayTitle } from '../lib/parser';
import { normalizeForSearch } from '../lib/searchNormalize';
import { getDescendantIds } from '../lib/taskHierarchy';
import type { Project, Task } from '../types';

/**
 * Modal para escolher (ou criar) a tarefa pai de `task`. Ao escolher um pai,
 * a tarefa atual passa a ser filha e fica oculta da lista principal. Exclui
 * a própria tarefa e todos os seus descendentes (evita ciclos).
 */
export function ParentPicker({
  task,
  allTasks,
  projects,
  onClose,
  onSelectParent,
  onCreateNewParent,
}: {
  task: Task;
  allTasks: Task[];
  projects: Project[];
  onClose: () => void;
  onSelectParent: (parentId: string) => void;
  onCreateNewParent: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const q = normalizeForSearch(filter.trim());
    const blocked = getDescendantIds(task.id, allTasks);
    blocked.add(task.id);
    return allTasks
      .filter((t) => !blocked.has(t.id) && t.taskId != null)
      .filter((t) => {
        if (projectFilter && t.section !== projectFilter) return false;
        if (!q) return true;
        return normalizeForSearch(getDisplayTitle(t.title)).includes(q);
      })
      .sort((a, b) => (a.taskId ?? 0) - (b.taskId ?? 0));
  }, [allTasks, task.id, filter, projectFilter]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h3>Adicionar pai a “{getDisplayTitle(task.title)}”</h3>
          <button
            onClick={onClose}
            className="icon-btn"
            style={{ fontSize: '25px' }}
            aria-label="fechar"
          >
            ×
          </button>
        </header>

        <section className="add-dep">
          <button
            type="button"
            className="btn-primary"
            style={{ width: '100%', marginBottom: '0.6rem' }}
            onClick={onCreateNewParent}
          >
             + Criar nova tarefa pai
          </button>

          <h4>Ou escolher existente</h4>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="inline-edit-input dep-project-select"
          >
            <option value="">Todos os projetos</option>
            {projects
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <input
            type="text"
            placeholder="Filtrar tarefas…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="inline-edit-input"
            style={{ marginTop: '0.4rem' }}
            autoFocus
          />
          <ul className="candidate-list">
            {candidates.slice(0, 50).map((t) => {
              const tag = `#${String(t.taskId).padStart(4, '0')}`;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelectParent(t.id)}
                    className="dep-candidate"
                  >
                    <span className="dep-tag">{tag}</span>
                    <span>{getDisplayTitle(t.title)}</span>
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
