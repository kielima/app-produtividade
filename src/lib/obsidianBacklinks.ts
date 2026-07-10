import { parseWikilinks, normalizeNoteName } from './obsidianWikilink';

// Lógica pura de resolução de wikilinks e backlinks — sem React, sem Drive.
// Opera sobre estruturas simples (não sobre VaultState diretamente) para
// ficar testável isoladamente; quem monta esses argumentos a partir do
// VaultState é src/views/ObsidianView.tsx.

export type NoteRef = { id: string; name: string; content: string };
export type BacklinkEntry = { id: string; name: string };

// Nome normalizado (sem .md, case-insensitive) → fileId. Construído a partir
// de tudo que já foi listado nesta sessão (VaultState.folders), não só das
// notas com conteúdo carregado — um wikilink pode apontar pra um arquivo cujo
// nome já apareceu numa listagem de pasta mesmo sem o conteúdo ter sido lido.
export function buildNameIndex(nodes: Array<{ id: string; name: string }>): Map<string, string> {
  const index = new Map<string, string>();
  for (const node of nodes) {
    index.set(normalizeNoteName(node.name), node.id);
  }
  return index;
}

export function resolveWikilinkTarget(
  nameIndex: Map<string, string>,
  target: string,
): string | undefined {
  return nameIndex.get(normalizeNoteName(target));
}

// Notas (dentre as já carregadas nesta sessão) cujo conteúdo cita `targetName`
// via [[wikilink]]. Limitação consciente e consistente com a Fase 1: só o que
// foi visualizado/expandido nesta sessão entra aqui — o índice completo
// (incluindo pastas nunca abertas) é o "nó fantasma" da Fase 3.
export function computeBacklinks(notes: NoteRef[], targetName: string): BacklinkEntry[] {
  const normalizedTarget = normalizeNoteName(targetName);
  const entries: BacklinkEntry[] = [];
  for (const note of notes) {
    const links = parseWikilinks(note.content);
    const cites = links.some((link) => normalizeNoteName(link.target) === normalizedTarget);
    if (cites) entries.push({ id: note.id, name: note.name });
  }
  return entries;
}
