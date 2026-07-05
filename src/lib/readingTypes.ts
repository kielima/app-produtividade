// Tipos ("estantes") da aba de leitura. Além dos três embutidos
// ('article' | 'book' | 'other'), o usuário pode criar tipos personalizados no
// editor de metadados — cada tipo distinto vira uma estante própria (um
// carrossel) na visualização em estante.
import type { ReadingItem, ReadingItemType } from '../types';

// Rótulos amigáveis dos tipos embutidos. Tipos personalizados são guardados já
// com o próprio texto de exibição, então não precisam de entrada aqui.
export const BUILTIN_TYPE_LABELS: Record<string, string> = {
  article: 'Artigo',
  book: 'Livro',
  other: 'Outro',
};

// Ordem canônica dos tipos embutidos ao dispor as estantes. Tipos
// personalizados vêm depois, ordenados alfabeticamente pelo rótulo.
const BUILTIN_ORDER: string[] = ['article', 'book', 'other'];

// Rótulo de exibição de um tipo: traduz os embutidos e devolve o próprio texto
// para os personalizados.
export function readingTypeLabel(type: string): string {
  return BUILTIN_TYPE_LABELS[type] ?? type;
}

// Converte o que o usuário digitou/escolheu no editor num valor canônico. Se
// corresponder à chave ou ao rótulo de um tipo embutido, guarda a chave
// embutida; caso contrário guarda o texto digitado (tipo personalizado). Vazio
// cai em 'other'.
export function readingTypeFromInput(input: string): ReadingItemType {
  const trimmed = input.trim();
  if (!trimmed) return 'other';
  const lower = trimmed.toLowerCase();
  for (const [key, label] of Object.entries(BUILTIN_TYPE_LABELS)) {
    if (lower === key || lower === label.toLowerCase()) return key;
  }
  return trimmed;
}

// Ordena uma lista de tipos: embutidos primeiro (na ordem canônica), depois os
// personalizados por rótulo. Usado para as opções de filtro e o datalist.
export function sortReadingTypes(types: string[]): string[] {
  return [...types].sort(compareTypes);
}

function compareTypes(a: string, b: string): number {
  const ia = BUILTIN_ORDER.indexOf(a);
  const ib = BUILTIN_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return readingTypeLabel(a).localeCompare(readingTypeLabel(b));
}

export interface ReadingShelf {
  type: string;
  label: string;
  items: ReadingItem[];
}

// Agrupa itens por tipo, cada grupo virando uma estante. Só devolve estantes
// com itens; a ordem segue `compareTypes`. Preserva a ordem original dos itens
// dentro de cada estante (já vêm ordenados por recência da subscription).
export function groupIntoShelves(items: ReadingItem[]): ReadingShelf[] {
  const byType = new Map<string, ReadingItem[]>();
  for (const it of items) {
    const t = it.itemType || 'other';
    const arr = byType.get(t);
    if (arr) arr.push(it);
    else byType.set(t, [it]);
  }
  return sortReadingTypes([...byType.keys()]).map((type) => ({
    type,
    label: readingTypeLabel(type),
    items: byType.get(type)!,
  }));
}
