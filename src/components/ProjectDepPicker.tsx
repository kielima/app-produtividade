import { useEffect, useMemo, useState } from 'react';
import { normalizeForSearch } from '../lib/searchNormalize';
import type { Project } from '../types';
import TrashIcon from './TrashIcon';

/**
 * Selector de dependência entre projetos.
 * Permite escolher um único projeto bloqueante. Quando o projeto escolhido
 * tiver 100% das tarefas concluídas o bloqueio é levantado automaticamente.
 */
export function ProjectDepPicker({
  currentProject,
  allProjects,
  onClose,
  onChange,
}: {
  currentProject: Project;
  allProjects: Project[];
  onClose: () => void;
  onChange: (dependsOnId: string | null) => void;
}) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const q = normalizeForSearch(filter.trim());
    return allProjects
      .filter((p) => p.id !== currentProject.id)
      .filter((p) => !q || normalizeForSearch(p.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [allProjects, currentProject.id, filter]);

  const selected = allProjects.find((p) => p.id === currentProject.dependsOn) ?? null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h3>Depende de — "{currentProject.name}"</h3>
          <button
            onClick={onClose}
            className="icon-btn"
            style={{ fontSize: '25px' }}
            aria-label="fechar"
          >
            ×
          </button>
        </header>

        <section className="cur-deps">
          <h4>Selecionado</h4>
          {selected ? (
            <ul>
              <li>
                <span>{selected.name}</span>
                <button
                  onClick={() => onChange(null)}
                  className="icon-btn"
                  aria-label="remover dependência"
                >
                  <TrashIcon size={18} />
                </button>
              </li>
            </ul>
          ) : (
            <p className="muted">Sem dependência.</p>
          )}
        </section>

        <section className="add-dep">
          <h4>Selecionar projeto</h4>
          <input
            type="text"
            placeholder="Filtrar projetos…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="inline-edit-input"
            autoFocus
          />
          <ul className="candidate-list">
            {candidates.map((p) => {
              const already = p.id === currentProject.dependsOn;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(already ? null : p.id);
                      onClose();
                    }}
                    disabled={already}
                    className="dep-candidate"
                  >
                    <span>{p.name}</span>
                    {already && <span className="muted">(selecionado)</span>}
                  </button>
                </li>
              );
            })}
            {candidates.length === 0 && <li className="muted">Nenhum projeto encontrado.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
