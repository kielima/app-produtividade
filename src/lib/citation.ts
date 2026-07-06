import type { ReadingItem } from '../types';

// Sobrenome de um nome "Nome [do meio] Sobrenome" (último token, maiúsculo) —
// heurística suficiente para os nomes já normalizados pelo Crossref/manual.
function surname(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] || name).toUpperCase();
}

// Autoria no padrão ABNT (NBR 10520): 1 autor -> "SOBRENOME"; 2 autores ->
// "SOBRENOME1; SOBRENOME2"; 3+ -> "SOBRENOME1 et al.".
function authorsAbnt(authors: string[]): string {
  const names = authors.map(surname).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}; ${names[1]}`;
  return `${names[0]} et al.`;
}

// Citação autor-data ABNT de uma anotação, ex.: "(AIHARA et al., 2010, p.1)".
// Sem autores cadastrados, cai para o título do item como referência.
export function formatAbntCitation(item: ReadingItem, page: number): string {
  const authorPart = authorsAbnt(item.authors) || item.title.trim();
  const year = item.year?.trim() || 's.d.';
  return `(${authorPart}, ${year}, p.${page})`;
}
