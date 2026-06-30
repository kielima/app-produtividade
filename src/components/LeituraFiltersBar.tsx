import type { ReadingItemType, ReadingStatus } from '../types';

export interface ReadingFiltersState {
  search: string;
  author: string; // '' = todos
  tag: string; // '' = todas
  itemType: ReadingItemType | 'all';
  status: ReadingStatus | 'all';
}

export function defaultReadingFiltersState(): ReadingFiltersState {
  return { search: '', author: '', tag: '', itemType: 'all', status: 'all' };
}

const READING_FILTERS_KEY = 'app-produtividade:reading-filters';

export function loadReadingFilters(): ReadingFiltersState {
  try {
    const raw = localStorage.getItem(READING_FILTERS_KEY);
    if (!raw) return defaultReadingFiltersState();
    const parsed = JSON.parse(raw) as Partial<ReadingFiltersState>;
    return { ...defaultReadingFiltersState(), ...parsed };
  } catch {
    return defaultReadingFiltersState();
  }
}

export function saveReadingFilters(state: ReadingFiltersState): void {
  try {
    localStorage.setItem(READING_FILTERS_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function LeituraFiltersBar({
  state,
  setState,
  allAuthors,
  allTags,
}: {
  state: ReadingFiltersState;
  setState: (s: ReadingFiltersState) => void;
  allAuthors: string[];
  allTags: string[];
}) {
  return (
    <div className="reading-filters">
      <input
        className="reading-search"
        type="search"
        placeholder="Pesquisar título, autor, DOI…"
        value={state.search}
        onChange={(e) => setState({ ...state, search: e.target.value })}
      />
      <select
        value={state.author}
        onChange={(e) => setState({ ...state, author: e.target.value })}
        aria-label="Filtrar por autor"
      >
        <option value="">Todos os autores</option>
        {allAuthors.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <select
        value={state.tag}
        onChange={(e) => setState({ ...state, tag: e.target.value })}
        aria-label="Filtrar por tag"
      >
        <option value="">Todas as tags</option>
        {allTags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select
        value={state.itemType}
        onChange={(e) =>
          setState({ ...state, itemType: e.target.value as ReadingFiltersState['itemType'] })
        }
        aria-label="Filtrar por tipo"
      >
        <option value="all">Todos os tipos</option>
        <option value="article">Artigos</option>
        <option value="book">Livros</option>
        <option value="other">Outros</option>
      </select>
      <select
        value={state.status}
        onChange={(e) =>
          setState({ ...state, status: e.target.value as ReadingFiltersState['status'] })
        }
        aria-label="Filtrar por status"
      >
        <option value="all">Todos os status</option>
        <option value="to-read">A ler</option>
        <option value="reading">Lendo</option>
        <option value="read">Lido</option>
      </select>
    </div>
  );
}
