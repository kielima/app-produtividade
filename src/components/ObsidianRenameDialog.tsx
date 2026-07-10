import { useState } from 'react';

// Diálogo simples de renomear (pasta/nota/arquivo) — acionado pelo menu de
// contexto do grafo (segurar em cima de um nó). Estilo backdrop+painel segue
// ObsidianConflictDialog.tsx; quem chama decide o valor inicial do campo
// (nome de exibição sem extensão pra notas, nome completo pra pasta/arquivo)
// e como reconstruir o nome final ao salvar.
export function ObsidianRenameDialog({
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
      <div className="obsidian-conflict-backdrop" aria-hidden="true" onClick={onCancel} />
      <div
        className="obsidian-conflict-dialog obsidian-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="obsidian-rename-title"
      >
        <h2 id="obsidian-rename-title">{title}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed) onSave(trimmed);
          }}
        >
          <input
            type="text"
            className="obsidian-rename-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            aria-label="Novo nome"
          />
          <div className="obsidian-conflict-actions">
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
