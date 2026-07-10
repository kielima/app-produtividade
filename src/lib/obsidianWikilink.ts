// Fonte única de verdade para a sintaxe de `[[wikilinks]]` — usada pelo
// destaque visual (obsidianWikilinkHighlight.ts), pela resolução de clique e
// pelo índice de backlinks/rename (obsidianBacklinks.ts, obsidianRename.ts).
// Suporta `[[Nota]]`, `[[Nota|Apelido]]` e `[[Nota#Título]]` (o cabeçalho é
// reconhecido mas descartado — navegar até um cabeçalho específico fica para
// uma fase futura; a nota inteira já resolve corretamente).

export type ParsedWikilink = {
  from: number;
  to: number;
  raw: string;
  target: string;
  alias: string;
};

const WIKILINK_RE = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/g;

export function parseWikilinks(text: string): ParsedWikilink[] {
  const links: ParsedWikilink[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    if (match.index == null) continue;
    const target = match[1].trim();
    const alias = match[2]?.trim() || target;
    links.push({
      from: match.index,
      to: match.index + match[0].length,
      raw: match[0],
      target,
      alias,
    });
  }
  return links;
}

// Nome do arquivo sem a extensão `.md` — wikilinks referenciam notas pelo
// nome "de exibição" (ex.: `[[Projeto X]]`), não pelo nome de arquivo cru.
export function stripMdExtension(name: string): string {
  return name.trim().replace(/\.md$/i, '');
}

// Normaliza um nome de nota para comparação (sem `.md`, sem espaços nas
// pontas, case-insensitive) — usado tanto para indexar nomes conhecidos
// quanto para resolver o alvo de um wikilink contra esse índice.
export function normalizeNoteName(name: string): string {
  return stripMdExtension(name).toLowerCase();
}
