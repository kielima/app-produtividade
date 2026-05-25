/**
 * Normaliza uma string para comparações de busca: aplica lowercase e
 * remove diacríticos (acentos, til, cedilha) via decomposição Unicode NFD.
 *
 * Permite que `Agência` case com `agencia`, `agência`, `AGÊNCIA`, etc.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
