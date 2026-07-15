import { useState } from 'react';

// Diálogo simples de renomear (pasta/nota/arquivo) — acionado pelo menu de
// contexto do grafo (segurar em cima de um nó). Estilo backdrop+painel segue
// GrafosConflictDialog.tsx; quem chama decide o valor inicial do campo
// (nome de exibição sem extensão pra notas, nome completo pra pasta/arquivo)
// e como reconstruir o nome final ao salvar.
export function GrafosRenameDialog({
  title,
  initialValue,
  onCancel,
  onSave,
}: {
  title: string;
  initialValue: string;
  onCancel: () => void;
  onSave: (newValue: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <>
      <div className="grafos-conflict-backdrop" aria-hidden="true" onClick={onCancel} />
      <div
        className="grafos-conflict-dialog grafos-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grafos-rename-title"
      >
        <h2 id="grafos-rename-title">{title}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed) onSave(trimmed);
          }}
        >
          <input
            type="text"
            className="grafos-rename-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            aria-label="Novo nome"
          />
          <div className="grafos-conflict-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={!value.trim()}>
              Renomear
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
