import type { ConflictState } from '../lib/grafosTree';

// Diálogo mostrado quando o arquivo foi modificado no Drive desde a última
// leitura nesta sessão (spec item 8) — nunca sobrescreve silenciosamente.
// Estilo (backdrop + painel + role=dialog) segue ShareTargetDialog.tsx.
export function GrafosConflictDialog({
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
      <div className="grafos-conflict-backdrop" aria-hidden="true" />
      <div
        className="grafos-conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grafos-conflict-title"
      >
        <h2 id="grafos-conflict-title">"{conflict.fileName}" mudou no Drive</h2>
        <p className="muted">
          Este arquivo foi modificado em outro lugar desde que você o abriu aqui. Escolha o que
          fazer:
        </p>
        <div className="grafos-conflict-panes">
          <div className="grafos-conflict-pane">
            <h3>Sua versão</h3>
            <pre>{conflict.localContent}</pre>
          </div>
          <div className="grafos-conflict-pane">
            <h3>Versão do Drive</h3>
            <pre>{conflict.remoteContent}</pre>
          </div>
        </div>
        <div className="grafos-conflict-actions">
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
