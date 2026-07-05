import { useMemo, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReadingItem } from '../types';
import { readingTypeLabel } from '../lib/readingTypes';
import { Popover } from './Popover';

// ---- Definição das colunas disponíveis ----

export type ReadingColumnKey =
  | 'title'
  | 'authors'
  | 'itemType'
  | 'year'
  | 'publication'
  | 'doi'
  | 'isbn'
  | 'issn'
  | 'tags'
  | 'status'
  | 'page'
  | 'added'
  | 'lastOpened';

interface ColumnDef {
  key: ReadingColumnKey;
  label: string;
  // Visível por padrão na primeira utilização.
  defaultVisible: boolean;
  render: (item: ReadingItem) => ReactNode;
}

const STATUS_LABEL: Record<ReadingItem['readingStatus'], string> = {
  'to-read': 'A ler',
  reading: 'Lendo',
  read: 'Lido',
};

function dateOnly(iso?: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

// Ordem canônica de todas as colunas conhecidas. A configuração persistida só
// guarda chave + visibilidade; novas colunas adicionadas aqui aparecem
// automaticamente no fim para quem já tinha uma configuração salva.
const ALL_COLUMNS: ColumnDef[] = [
  {
    key: 'title',
    label: 'Título',
    defaultVisible: true,
    render: (it) => it.title || '(sem título)',
  },
  {
    key: 'authors',
    label: 'Autores',
    defaultVisible: true,
    render: (it) => it.authors.join(', '),
  },
  {
    key: 'itemType',
    label: 'Tipo',
    defaultVisible: true,
    render: (it) => readingTypeLabel(it.itemType),
  },
  {
    key: 'year',
    label: 'Ano',
    defaultVisible: true,
    render: (it) => it.year ?? '',
  },
  {
    key: 'publication',
    label: 'Publicação',
    defaultVisible: true,
    render: (it) => it.publication ?? '',
  },
  {
    key: 'doi',
    label: 'DOI',
    defaultVisible: false,
    render: (it) => it.doi ?? '',
  },
  {
    key: 'isbn',
    label: 'ISBN',
    defaultVisible: false,
    render: (it) => it.isbn ?? '',
  },
  {
    key: 'issn',
    label: 'ISSN',
    defaultVisible: false,
    render: (it) => it.issn ?? '',
  },
  {
    key: 'tags',
    label: 'Tags',
    defaultVisible: true,
    render: (it) =>
      it.tags.length > 0 ? (
        <div className="reading-table-tags">
          {it.tags.map((t) => (
            <span key={t} className="reading-tag">
              {t}
            </span>
          ))}
        </div>
      ) : (
        ''
      ),
  },
  {
    key: 'status',
    label: 'Status',
    defaultVisible: true,
    render: (it) => (
      <span className={`reading-status-pill badge-${it.readingStatus}`}>
        {STATUS_LABEL[it.readingStatus]}
      </span>
    ),
  },
  {
    key: 'page',
    label: 'Página',
    defaultVisible: false,
    render: (it) => (it.currentPage ? String(it.currentPage) : ''),
  },
  {
    key: 'added',
    label: 'Adicionado',
    defaultVisible: false,
    render: (it) => it.addedDate,
  },
  {
    key: 'lastOpened',
    label: 'Última leitura',
    defaultVisible: false,
    render: (it) => dateOnly(it.lastOpenedAt),
  },
];

const COLUMN_BY_KEY = new Map(ALL_COLUMNS.map((c) => [c.key, c]));

// ---- Configuração persistida (ordem + visibilidade) ----

export interface ReadingColumnConfig {
  key: ReadingColumnKey;
  visible: boolean;
}

const READING_COLUMNS_KEY = 'app-produtividade:reading-columns';

export function defaultReadingColumns(): ReadingColumnConfig[] {
  return ALL_COLUMNS.map((c) => ({ key: c.key, visible: c.defaultVisible }));
}

// Reconcilia a config salva com as colunas conhecidas: preserva ordem e
// visibilidade do que existe, descarta chaves obsoletas e acrescenta colunas
// novas (introduzidas em versões posteriores) no fim, com a visibilidade padrão.
function reconcile(saved: ReadingColumnConfig[]): ReadingColumnConfig[] {
  const seen = new Set<ReadingColumnKey>();
  const out: ReadingColumnConfig[] = [];
  for (const c of saved) {
    if (COLUMN_BY_KEY.has(c.key) && !seen.has(c.key)) {
      out.push({ key: c.key, visible: !!c.visible });
      seen.add(c.key);
    }
  }
  for (const c of ALL_COLUMNS) {
    if (!seen.has(c.key)) out.push({ key: c.key, visible: c.defaultVisible });
  }
  return out;
}

export function loadReadingColumns(): ReadingColumnConfig[] {
  try {
    const raw = localStorage.getItem(READING_COLUMNS_KEY);
    if (!raw) return defaultReadingColumns();
    const parsed = JSON.parse(raw) as ReadingColumnConfig[];
    if (!Array.isArray(parsed)) return defaultReadingColumns();
    return reconcile(parsed);
  } catch {
    return defaultReadingColumns();
  }
}

export function saveReadingColumns(cols: ReadingColumnConfig[]): void {
  try {
    localStorage.setItem(READING_COLUMNS_KEY, JSON.stringify(cols));
  } catch {
    // ignore
  }
}

// ---- Cabeçalho arrastável ----

function SortableHeader({ col, label }: { col: ReadingColumnKey; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  return (
    <th ref={setNodeRef} style={style} scope="col" className="reading-table-th">
      <span
        className="reading-table-th-grip"
        {...attributes}
        {...listeners}
        title="Arraste para reordenar"
      >
        {label}
      </span>
    </th>
  );
}

// ---- Menu de colunas (mostrar/ocultar) ----

function ColumnsMenu({
  columns,
  onToggle,
  onReset,
}: {
  columns: ReadingColumnConfig[];
  onToggle: (key: ReadingColumnKey) => void;
  onReset: () => void;
}) {
  return (
    <Popover
      align="end"
      trigger={(open, isOpen) => (
        <button
          type="button"
          className="reading-columns-btn"
          onClick={open}
          aria-expanded={isOpen}
        >
          Colunas ▾
        </button>
      )}
    >
      {() => (
        <div className="reading-columns-menu">
          {columns.map((c) => {
            const def = COLUMN_BY_KEY.get(c.key);
            if (!def) return null;
            return (
              <label key={c.key} className="reading-columns-item">
                <input
                  type="checkbox"
                  checked={c.visible}
                  onChange={() => onToggle(c.key)}
                />
                <span>{def.label}</span>
              </label>
            );
          })}
          <button type="button" className="reading-columns-reset" onClick={onReset}>
            Restaurar padrão
          </button>
        </div>
      )}
    </Popover>
  );
}

// ---- Tabela ----

export function ReadingTable({
  items,
  columns,
  setColumns,
  onOpen,
  onEditMetadata,
}: {
  items: ReadingItem[];
  columns: ReadingColumnConfig[];
  setColumns: (next: ReadingColumnConfig[]) => void;
  onOpen: (item: ReadingItem) => void;
  onEditMetadata: (item: ReadingItem) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useMemo(
    () => columns.filter((c) => c.visible && COLUMN_BY_KEY.has(c.key)),
    [columns],
  );
  const visibleKeys = useMemo(() => visible.map((c) => c.key), [visible]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = columns.findIndex((c) => c.key === active.id);
    const to = columns.findIndex((c) => c.key === over.id);
    if (from === -1 || to === -1) return;
    setColumns(arrayMove(columns, from, to));
  }

  function toggle(key: ReadingColumnKey) {
    setColumns(columns.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  }

  return (
    <div className="reading-table-wrap">
      <div className="reading-table-bar">
        <ColumnsMenu
          columns={columns}
          onToggle={toggle}
          onReset={() => setColumns(defaultReadingColumns())}
        />
      </div>
      <div className="reading-table-scroll">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className="reading-table">
            <thead>
              <tr>
                <SortableContext
                  items={visibleKeys}
                  strategy={horizontalListSortingStrategy}
                >
                  {visible.map((c) => (
                    <SortableHeader
                      key={c.key}
                      col={c.key}
                      label={COLUMN_BY_KEY.get(c.key)!.label}
                    />
                  ))}
                </SortableContext>
                <th scope="col" className="reading-table-th reading-table-actions-th">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  {visible.map((c) => (
                    <td key={c.key} className={`reading-td reading-td-${c.key}`}>
                      {COLUMN_BY_KEY.get(c.key)!.render(it)}
                    </td>
                  ))}
                  <td className="reading-td reading-table-actions">
                    <button
                      type="button"
                      className="reading-table-action"
                      onClick={() => onOpen(it)}
                    >
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="reading-table-action"
                      onClick={() => onEditMetadata(it)}
                    >
                      Metadados
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DndContext>
        {items.length === 0 && (
          <p className="muted leitura-no-match">Nenhum item corresponde aos filtros.</p>
        )}
      </div>
    </div>
  );
}
