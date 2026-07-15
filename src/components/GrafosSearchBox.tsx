import { useRef, useState } from 'react';
import type { DriveNode } from '../lib/grafosDrive';
import { isMarkdownFile } from '../lib/grafosNode';
import { MIN_SEARCH_QUERY_LENGTH } from '../lib/grafosSearch';
import { stripMdExtension } from '../lib/grafosWikilink';
import { useDebouncedCallback } from '../lib/useDebouncedCallback';
import { DriveFileIcon } from '../lib/driveFileIcons';
import { SearchInput } from './SearchBar';

const SEARCH_DEBOUNCE_MS = 300;

type SearchResults = { byName: DriveNode[]; byContent: DriveNode[] };
const EMPTY_RESULTS: SearchResults = { byName: [], byContent: [] };

// Caixa de busca geral da aba (Fase 4/spec item 6-7) — por nome e por
// conteúdo, em todo o Drive. Sempre "expandida": quem decide se aparece ou só
// o botão de ícone (igual às outras abas) é o `GrafosVaultBrowser` pai, que
// troca este componente pelo `SearchToggle` compartilhado quando fechado.
export function GrafosSearchBox({
  searchVaultWide,
  onOpenNote,
  onOpenFolder,
  onClose,
}: {
  searchVaultWide: (query: string) => Promise<SearchResults>;
  onOpenNote: (node: DriveNode) => void;
  onOpenFolder: (node: DriveNode) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
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
    onClose();
  }

  const trimmedLength = query.trim().length;
  const showHint = trimmedLength > 0 && trimmedLength < MIN_SEARCH_QUERY_LENGTH;
  const hasResults = results.byName.length > 0 || results.byContent.length > 0;
  const showDropdown = trimmedLength > 0;

  return (
    <div className="grafos-search-box">
      <SearchInput
        query={query}
        setQuery={setQuery}
        onClose={onClose}
        placeholder="Buscar no Drive inteiro…"
      />
      {showDropdown && (
        <div className="grafos-search-results">
          {showHint && (
            <p className="grafos-search-empty-hint">
              Digite pelo menos {MIN_SEARCH_QUERY_LENGTH} caracteres.
            </p>
          )}
          {!showHint && loading && <p className="grafos-search-empty-hint">Buscando…</p>}
          {!showHint && !loading && !hasResults && (
            <p className="grafos-search-empty-hint">Nenhum resultado encontrado.</p>
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
    <div className="grafos-search-result-group">
      <p className="grafos-search-result-group-label">{label}</p>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            <button type="button" className="grafos-search-result-item" onClick={() => onClick(node)}>
              <DriveFileIcon node={node} />
              <span>{node.isFolder ? node.name : stripMdExtension(node.name)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
