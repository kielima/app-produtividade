import type { useGrafosVault } from '../lib/grafosTree';
import type { FolderState } from '../lib/grafosTreeState';

type Vault = ReturnType<typeof useGrafosVault>;

const ROOT_LABEL = 'Meu Drive';

// Diálogo "mover para pasta" — acionado pelo menu de contexto do grafo.
// Reaproveita o MESMO estado de pastas/expansão do vault (nada de árvore
// paralela): navegar aqui carrega/expande pastas exatamente como a árvore
// principal faz, só que restrito a mostrar apenas subpastas (não notas/
// arquivos, que não são destinos válidos).
export function GrafosMoveDialog({
  vault,
  itemName,
  excludeFolderId,
  onCancel,
  onMoveTo,
}: {
  vault: Vault;
  itemName: string;
  excludeFolderId: string;
  onCancel: () => void;
  onMoveTo: (destFolderId: string) => void;
}) {
  return (
    <>
      <div className="grafos-conflict-backdrop" aria-hidden="true" onClick={onCancel} />
      <div
        className="grafos-conflict-dialog grafos-move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grafos-move-title"
      >
        <h2 id="grafos-move-title">Mover &quot;{itemName}&quot;</h2>
        <p className="muted">Escolha a pasta de destino.</p>
        <div className="grafos-move-tree">
          {vault.state.rootId && (
            <MoveFolderRow
              vault={vault}
              folderId={vault.state.rootId}
              label={ROOT_LABEL}
              depth={0}
              excludeFolderId={excludeFolderId}
              onMoveTo={onMoveTo}
            />
          )}
        </div>
        <div className="grafos-conflict-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </>
  );
}

function MoveFolderRow({
  vault,
  folderId,
  label,
  depth,
  excludeFolderId,
  onMoveTo,
}: {
  vault: Vault;
  folderId: string;
  label: string;
  depth: number;
  excludeFolderId: string;
  onMoveTo: (destFolderId: string) => void;
}) {
  const expanded = vault.state.expandedIds.has(folderId);
  const folder: FolderState | undefined = vault.state.folders.get(folderId);
  // A própria pasta sendo movida nunca é um destino válido (não dá pra
  // navegar pra dentro dela nem selecioná-la) — evita o caso mais óbvio de
  // ciclo (mover uma pasta pra dentro de si mesma). Um ciclo mais profundo
  // (mover pra dentro de uma sub-sub-pasta dela) não é bloqueado aqui: exigiria
  // carregar a subárvore inteira antecipadamente só pra checar isso.
  const isExcluded = folderId === excludeFolderId;

  return (
    <div className="grafos-move-row-group" style={{ paddingLeft: depth * 16 }}>
      <div className="grafos-move-row">
        <button
          type="button"
          className="grafos-move-row-toggle"
          onClick={() => (expanded ? vault.collapseFolder(folderId) : void vault.expandFolder(folderId))}
          aria-expanded={expanded}
        >
          {expanded ? '▾' : '▸'} {label}
        </button>
        {!isExcluded && (
          <button type="button" className="btn-secondary grafos-move-row-pick" onClick={() => onMoveTo(folderId)}>
            Mover para cá
          </button>
        )}
      </div>
      {expanded && folder?.status === 'loading' && <p className="muted grafos-tree-status">Carregando…</p>}
      {expanded && folder?.status === 'error' && <p className="error grafos-tree-status">{folder.error}</p>}
      {expanded &&
        folder?.status === 'loaded' &&
        folder.children
          .filter((c) => c.isFolder && c.id !== excludeFolderId)
          .map((c) => (
            <MoveFolderRow
              key={c.id}
              vault={vault}
              folderId={c.id}
              label={c.name}
              depth={depth + 1}
              excludeFolderId={excludeFolderId}
              onMoveTo={onMoveTo}
            />
          ))}
    </div>
  );
}
