import { useEffect, useRef } from 'react';

function SearchIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function SearchToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className="topbar-search">
      <button
        type="button"
        className={`btn-secondary search-toggle${active ? ' search-toggle--active' : ''}`}
        onClick={onClick}
        aria-label={active ? 'Pesquisa ativa — abrir' : 'Pesquisar'}
        title="Pesquisar"
      >
        <SearchIcon />
      </button>
    </div>
  );
}

export function SearchInput({
  query,
  setQuery,
  onClose,
  placeholder,
}: {
  query: string;
  setQuery: (q: string) => void;
  onClose: () => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (query) {
        setQuery('');
      } else {
        onClose();
      }
    }
  }

  return (
    <div className="topbar-searchbar" role="search">
      <button
        type="button"
        className="topbar-searchbar-close"
        onClick={onClose}
        aria-label="Fechar pesquisa"
      >
        <CloseIcon />
      </button>
      <div className="topbar-searchbar-input-wrap">
        <span className="topbar-searchbar-icon" aria-hidden="true">
          <SearchIcon size={18} />
        </span>
        <input
          ref={inputRef}
          type="search"
          className="topbar-searchbar-input"
          value={query}
          placeholder={placeholder ?? 'Pesquisar...'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Pesquisar"
        />
        {query && (
          <button
            type="button"
            className="topbar-searchbar-clear"
            onClick={() => setQuery('')}
            aria-label="Limpar pesquisa"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
