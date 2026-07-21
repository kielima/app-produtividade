// Heurística rápida: nomes de arquivo no estilo de citação ABNT
// ("SOBRENOME, 2020.pdf", "SOBRENOME et al, 2020.pdf",
// "SOBRENOME; SOBRENOME2, 2020.pdf" — com ou sem título depois) indicam um
// artigo. Livros são nomeados de forma bem diferente (pelo título), então o
// padrão sozinho já é um sinal confiável. Usado na sincronização do Drive
// para classificar artigos na hora, sem precisar abrir o PDF nem chamar IA.
const ABNT_ARTICLE_PATTERN = /^[^\d,]{2,60},\s*(19|20)\d{2}(?:\D|$)/u;

// Arquivos de normas técnicas seguem a convenção "NBR ..."/"ISO ..." em
// maiúsculas (ex.: "NBR 5410.pdf", "ISO 9001-2015.pdf"). O lookahead evita
// falso positivo em palavras que só começam com essas letras (ex.:
// "ISOLAMENTO.pdf"), exigindo que "NBR"/"ISO" não seja seguido de outra letra.
const TECHNICAL_STANDARD_PATTERN = /^(?:NBR|ISO)(?![A-Za-z])/;

export const TECHNICAL_STANDARD_TYPE = 'Normas Técnicas';

export function classifyByFileName(
  fileName: string,
): 'article' | typeof TECHNICAL_STANDARD_TYPE | null {
  const trimmed = fileName.trim();
  if (TECHNICAL_STANDARD_PATTERN.test(trimmed)) return TECHNICAL_STANDARD_TYPE;
  return ABNT_ARTICLE_PATTERN.test(trimmed) ? 'article' : null;
}
