// Lógica pura da busca geral (Fase 4) — sem import de googleDrive.ts/firebase.ts,
// testável sem mock de rede/DOM (mesma convenção de grafosGraph.ts/grafosBacklinks.ts).

import type { DriveNode } from './grafosNode';

// Buscas de conteúdo (`fullText contains`) com menos de 3 caracteres tendem a
// bater em quase tudo no Drive — exige um mínimo antes de disparar a rede.
export const MIN_SEARCH_QUERY_LENGTH = 3;

// Cap na busca por conteúdo da caixa de busca geral: evita paginar o Drive
// inteiro a cada tecla digitada (diferente da correção de links no rename,
// que precisa de todos os resultados e por isso não usa este limite).
export const CONTENT_SEARCH_MAX_RESULTS = 20;

// A API do Drive não devolve nenhum score de relevância pra `fullText
// contains`, então os resultados por nome e por conteúdo ficam em dois grupos
// rotulados (não uma lista única "ranqueada", que seria enganosa). O único
// merge necessário é dedup: um arquivo que bate nos dois critérios aparece só
// uma vez, sob "Nome" (sinal mais forte).
export function dedupeContentMatches(byName: DriveNode[], byContent: DriveNode[]): DriveNode[] {
  const nameIds = new Set(byName.map((n) => n.id));
  return byContent.filter((n) => !nameIds.has(n.id));
}
