/**
 * Normaliza uma tag única: trim + lowercase + colapsa espaços internos.
 * Retorna string vazia se a entrada não tem conteúdo útil.
 */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normaliza uma lista de tags: aplica `normalizeTag`, remove vazias e
 * deduplica preservando a ordem da primeira ocorrência.
 */
export function normalizeTags(raws: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const t = normalizeTag(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Quebra uma string digitada pelo usuário em tags individuais por vírgula
 * ou ponto-e-vírgula, normalizando cada uma.
 */
export function parseTagsInput(input: string): string[] {
  return normalizeTags(input.split(/[,;]/));
}

/** Tag aplicada automaticamente a notas que contêm pelo menos um link. */
export const LINK_TAG = 'link';

const URL_RE = /(?:\bhttps?:\/\/|\bwww\.)\S+/i;

/**
 * Detecta se um texto contém pelo menos uma URL (http(s)://… ou www.…).
 * Suficiente para cobrir links Markdown `[label](url)` e URLs cruas.
 */
export function hasLink(text: string): boolean {
  if (!text) return false;
  return URL_RE.test(text);
}
