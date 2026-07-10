import { useRef, useState } from 'react';
import type { DriveNode } from '../lib/obsidianDrive';
import { isMarkdownFile } from '../lib/obsidianNode';
import { MIN_SEARCH_QUERY_LENGTH } from '../lib/obsidianSearch';
import { stripMdExtension } from '../lib/obsidianWikilink';
import { useDebouncedCallback } from '../lib/useDebouncedCallback';
import { DriveFileIcon } from '../lib/driveFileIcons';

const SEARCH_DEBOUNCE_MS = 300;

type SearchResults = { byName: DriveNode[]; byContent: DriveNode[] };
const EMPTY_RESULTS: SearchResults = { byName: [], byContent: [] };

// Caixa de busca geral da aba (Fase 4/spec item 6-7) — por nome e por
// conteúdo, em todo o Drive. Componente próprio (não inline em
// ObsidianView.tsx) seguindo o mesmo padrão de arquivo dos demais pedaços de
// UI da aba (ObsidianEditor, ObsidianGraphView, etc.).
export function ObsidianSearchBox({
  searchVaultWide,
  onOpenNote,
  onOpenFolder,
}: {
  searchVaultWide: (query: string) => Promise<SearchResults>;
  onOpenNote: (node: DriveNode) => void;
  onOpenFolder: (node: DriveNode) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const requestIdRef = useRef(0);

  // 300ms (mais que os 150ms do autocomplete de `[[` no editor, já que aqui
  // saem DUAS chamadas de rede por tecla) + guarda por id incremental contra
  // resposta fora de ordem — `useDebouncedCallback` só atrasa a chamada, não
  // garante que respostas cheguem na ordem em que as buscas foram disparadas.
  useDebouncedCallback(
    () => {
      const trimmed = query.trim();
      if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
        requestIdRef.current++;
        setResults(EMPTY_RESULTS);
        setLoading(false);
        return;
      }
      const requestId = ++requestIdRef.current;
      setLoading(true);
      void searchVaultWide(trimmed).then((found) => {
        if (requestId !== requestIdRef.current) return;
        setResults(found);
        setLoading(false);
      });
    },
    SEARCH_DEBOUNCE_MS,
    [query],
  );

  function handleResultClick(node: DriveNode) {
    if (node.isFolder) {
      onOpenFolder(node);
    } else if (isMarkdownFile(node)) {
      onOpenNote(node);
    } else {
      window.open(`https://drive.google.com/file/d/${node.id}/view`, '_blank', 'noopener');
    }
    setOpen(false);
  }

  const trimmedLength = query.trim().length;
  const showHint = trimmedLength > 0 && trimmedLength < MIN_SEARCH_QUERY_LENGTH;
  const hasResults = results.byName.length > 0 || results.byContent.length > 0;
  const showDropdown = open && query.trim().length > 0;

  return (
    <div className="obsidian-search-box">
      <input
        type="search"
        className="obsidian-search-input"
        placeholder="Buscar no Drive inteiro…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label="Buscar notas e arquivos no Drive"
      />
      {showDropdown && (
        <div className="obsidian-search-results">
          {showHint && (
            <p className="obsidian-search-empty-hint">
              Digite pelo menos {MIN_SEARCH_QUERY_LENGTH} caracteres.
            </p>
          )}
          {!showHint && loading && <p className="obsidian-search-empty-hint">Buscando…</p>}
          {!showHint && !loading && !hasResults && (
            <p className="obsidian-search-empty-hint">Nenhum resultado encontrado.</p>
          )}
          {!showHint && !loading && results.byName.length > 0 && (
            <ResultGroup label="Nome" nodes={results.byName} onClick={handleResultClick} />
          )}
          {!showHint && !loading && results.byContent.length > 0 && (
            <ResultGroup label="Conteúdo" nodes={results.byContent} onClick={handleResultClick} />
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  nodes,
  onClick,
}: {
  label: string;
  nodes: DriveNode[];
  onClick: (node: DriveNode) => void;
}) {
  return (
    <div className="obsidian-search-result-group">
      <p className="obsidian-search-result-group-label">{label}</p>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className="obsidian-search-result-item"
              // onMouseDown (não onClick) dispara antes do onBlur do input,
              // que senão fecharia o dropdown antes do clique ser registrado.
              onMouseDown={(e) => {
                e.preventDefault();
                onClick(node);
              }}
            >
              <DriveFileIcon node={node} />
              <span>{node.isFolder ? node.name : stripMdExtension(node.name)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
