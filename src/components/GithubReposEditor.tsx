import { useId, useState } from 'react';

// Aceita "owner/repo" ou a URL do GitHub e devolve "owner/repo".
export function normalizarRepo(entrada: string): string | null {
  const limpo = entrada
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const m = limpo.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Lista editável dos repositórios do GitHub de um projeto: chips com link,
 * remover com ×, e um campo para adicionar (com sugestões dos repositórios já
 * usados em outros projetos).
 */
export function GithubReposEditor({
  repos,
  sugestoes,
  onChange,
}: {
  repos: string[];
  sugestoes: string[];
  onChange: (next: string[]) => void | Promise<void>;
}) {
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const listId = useId();

  function adicionar() {
    if (!valor.trim()) return;
    const repo = normalizarRepo(valor);
    if (!repo) {
      setErro('Use o formato dono/repositorio (ou cole a URL do GitHub).');
      return;
    }
    setErro(null);
    setValor('');
    if (repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return;
    void onChange([...repos, repo]);
  }

  return (
    <div className="github-repos">
      {repos.length > 0 ? (
        <ul className="github-repos-lista">
          {repos.map((r) => (
            <li key={r} className="tag-chip github-repo-chip">
              <a href={`https://github.com/${r}`} target="_blank" rel="noreferrer">
                {r}
              </a>
              <button
                type="button"
                onClick={() => void onChange(repos.filter((x) => x !== r))}
                aria-label={`desvincular ${r}`}
                title="desvincular"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nenhum repositório vinculado.</p>
      )}
      <div className="github-repos-add">
        <input
          type="text"
          list={listId}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              adicionar();
            }
          }}
          placeholder="dono/repositorio"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <datalist id={listId}>
          {sugestoes
            .filter((s) => !repos.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
        <button type="button" className="btn-secondary" onClick={adicionar} disabled={!valor.trim()}>
          vincular
        </button>
      </div>
      {erro && <p className="error">{erro}</p>}
    </div>
  );
}
