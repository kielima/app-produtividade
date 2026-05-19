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
