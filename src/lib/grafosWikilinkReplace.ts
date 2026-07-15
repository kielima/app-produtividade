import { normalizeNoteName } from './grafosWikilink';

// Reconstrói o wikilink trocando só o alvo, preservando cabeçalho (`#...`) e
// apelido (`|...`) originais verbatim — não usa parseWikilinks (que já
// descarta o cabeçalho para fins de exibição/resolução) porque aqui
// precisamos regravar o texto exato, não só decidir se resolve.
//
// Mantido num arquivo próprio, sem nenhum import de googleDrive.ts/Drive/
// Firebase, para ser testável isoladamente (grafosWikilinkReplace.test.ts)
// — mesma convenção de grafosNode.ts/grafosTreeState.ts na Fase 1. A
// orquestração de rede (renameNoteAndFixLinks) fica em grafosRename.ts.
const RENAME_WIKILINK_RE = /\[\[([^\]\n|#]+)((?:#[^\]\n|]*)?)((?:\|[^\]\n]+)?)\]\]/g;

export function replaceWikilinkTarget(content: string, oldName: string, newName: string): string {
  const oldNormalized = normalizeNoteName(oldName);
  return content.replace(RENAME_WIKILINK_RE, (raw, target: string, headingPart: string, aliasPart: string) => {
    if (normalizeNoteName(target) !== oldNormalized) return raw;
    return `[[${newName}${headingPart}${aliasPart}]]`;
  });
}
