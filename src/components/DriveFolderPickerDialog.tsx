import { useState } from 'react';
import { listFolderChildren, type DriveNode } from '../lib/grafosDrive';

const ROOT_ID = 'root';
const ROOT_LABEL = 'Meu Drive';

type ChildrenState =
  | { status: 'loading' }
  | { status: 'loaded'; folders: DriveNode[] }
  | { status: 'error'; error: string };

// Diálogo genérico "escolher pasta no Drive" — navega a árvore de pastas sob
// demanda (lazy-load ao expandir), independente do vault do Grafos. Usado
// pelo botão "salvar no Drive" de tarefas/anotações (ver ExportToDriveButton),
// que não tem (nem precisa de) o estado de árvore completo do useGrafosVault.
export function DriveFolderPickerDialog({
  token,
  title,
  busy = false,
  onCancel,
  onSelect,
}: {
  token: string;
  title: string;
  busy?: boolean;
  onCancel: () => void;
  onSelect: (folderId: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [childrenById, setChildrenById] = useState<Map<string, ChildrenState>>(new Map());

  async function toggle(folderId: string) {
    if (expandedIds.has(folderId)) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      return;
    }
    setExpandedIds((prev) => new Set(prev).add(folderId));
    if (childrenById.has(folderId)) return;
    setChildrenById((prev) => new Map(prev).set(folderId, { status: 'loading' }));
    try {
      const all = await listFolderChildren(token, folderId);
      const folders = all.filter((n) => n.isFolder);
      setChildrenById((prev) => new Map(prev).set(folderId, { status: 'loaded', folders }));
    } catch (e) {
      setChildrenById((prev) =>
        new Map(prev).set(folderId, {
          status: 'error',
          error: e instanceof Error ? e.message : 'Falha ao listar pastas.',
        }),
      );
    }
  }

  return (
    <>
      <div className="grafos-conflict-backdrop" aria-hidden="true" onClick={busy ? undefined : onCancel} />
      <div
        className="grafos-conflict-dialog grafos-move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-picker-title"
      >
        <h2 id="drive-picker-title">{title}</h2>
        <p className="muted">Escolha a pasta de destino no Google Drive.</p>
        <div className="grafos-move-tree">
          <DriveFolderRow
            folderId={ROOT_ID}
            label={ROOT_LABEL}
            depth={0}
            expandedIds={expandedIds}
            childrenById={childrenById}
            busy={busy}
            onToggle={toggle}
            onSelect={onSelect}
          />
        </div>
        <div className="grafos-conflict-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>
    </>
  );
}

function DriveFolderRow({
  folderId,
  label,
  depth,
  expandedIds,
  childrenById,
  busy,
  onToggle,
  onSelect,
}: {
  folderId: string;
  label: string;
  depth: number;
  expandedIds: Set<string>;
  childrenById: Map<string, ChildrenState>;
  busy: boolean;
  onToggle: (folderId: string) => void;
  onSelect: (folderId: string) => void;
}) {
  const expanded = expandedIds.has(folderId);
  const state = childrenById.get(folderId);

  return (
    <div className="grafos-move-row-group" style={{ paddingLeft: depth * 16 }}>
      <div className="grafos-move-row">
        <button
          type="button"
          className="grafos-move-row-toggle"
          onClick={() => onToggle(folderId)}
          aria-expanded={expanded}
          disabled={busy}
        >
          {expanded ? '▾' : '▸'} {label}
        </button>
        <button
          type="button"
          className="btn-secondary grafos-move-row-pick"
          onClick={() => onSelect(folderId)}
          disabled={busy}
        >
          Salvar aqui
        </button>
      </div>
      {expanded && state?.status === 'loading' && <p className="muted grafos-tree-status">Carregando…</p>}
      {expanded && state?.status === 'error' && <p className="error grafos-tree-status">{state.error}</p>}
      {expanded &&
        state?.status === 'loaded' &&
        state.folders.map((f) => (
          <DriveFolderRow
            key={f.id}
            folderId={f.id}
            label={f.name}
            depth={depth + 1}
            expandedIds={expandedIds}
            childrenById={childrenById}
            busy={busy}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}
