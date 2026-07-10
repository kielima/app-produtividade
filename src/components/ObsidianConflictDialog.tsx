import type { ConflictState } from '../lib/obsidianTree';

// Diálogo mostrado quando o arquivo foi modificado no Drive desde a última
// leitura nesta sessão (spec item 8) — nunca sobrescreve silenciosamente.
// Estilo (backdrop + painel + role=dialog) segue ShareTargetDialog.tsx.
export function ObsidianConflictDialog({
  conflict,
  onKeepMine,
  onUseRemote,
  onKeepBoth,
}: {
  conflict: Extract<ConflictState, { status: 'comparing' }>;
  onKeepMine: () => void;
  onUseRemote: () => void;
  onKeepBoth: () => void;
}) {
  return (
    <>
      <div className="obsidian-conflict-backdrop" aria-hidden="true" />
      <div
        className="obsidian-conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="obsidian-conflict-title"
      >
        <h2 id="obsidian-conflict-title">"{conflict.fileName}" mudou no Drive</h2>
        <p className="muted">
          Este arquivo foi modificado em outro lugar desde que você o abriu aqui. Escolha o que
          fazer:
        </p>
        <div className="obsidian-conflict-panes">
          <div className="obsidian-conflict-pane">
            <h3>Sua versão</h3>
            <pre>{conflict.localContent}</pre>
          </div>
          <div className="obsidian-conflict-pane">
            <h3>Versão do Drive</h3>
            <pre>{conflict.remoteContent}</pre>
          </div>
        </div>
        <div className="obsidian-conflict-actions">
          <button type="button" className="btn-secondary" onClick={onUseRemote}>
            Usar a do Drive
          </button>
          <button type="button" className="btn-secondary" onClick={onKeepBoth}>
            Manter as duas
          </button>
          <button type="button" className="btn-primary" onClick={onKeepMine}>
            Manter a minha
          </button>
        </div>
      </div>
    </>
  );
}
