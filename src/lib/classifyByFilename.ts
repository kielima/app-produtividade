// Heurística rápida: nomes de arquivo no estilo de citação ABNT
// ("SOBRENOME, 2020.pdf", "SOBRENOME et al, 2020.pdf",
// "SOBRENOME; SOBRENOME2, 2020.pdf" — com ou sem título depois) indicam um
// artigo. Livros são nomeados de forma bem diferente (pelo título), então o
// padrão sozinho já é um sinal confiável. Usado na sincronização do Drive
// para classificar artigos na hora, sem precisar abrir o PDF nem chamar IA.
const ABNT_ARTICLE_PATTERN = /^[^\d,]{2,60},\s*(19|20)\d{2}(?:\D|$)/u;

export function classifyByFileName(fileName: string): 'article' | null {
  return ABNT_ARTICLE_PATTERN.test(fileName.trim()) ? 'article' : null;
}
