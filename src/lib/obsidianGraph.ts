import { parseWikilinks, normalizeNoteName } from './obsidianWikilink';
import { buildNameIndex, resolveWikilinkTarget } from './obsidianBacklinks';
import { findParentFolderId, type VaultState } from './obsidianTreeState';
import { isMarkdownFile } from './obsidianNode';

// Construtor puro do grafo unificado (spec item 4) — sem Drive/Firebase/CM6,
// testável isoladamente (obsidianGraph.test.ts). Opera direto sobre
// VaultState (a mesma estrutura chaveada por id da Fase 1), sem precisar de
// nenhum estado adicional: a árvore (src/views/ObsidianView.tsx) e o grafo
// (src/components/ObsidianGraphView.tsx) são só duas visualizações da mesma
// fonte de verdade.

export type GraphNodeKind = 'folder' | 'note' | 'file' | 'ghost';
export type GraphLinkKind = 'containment' | 'wikilink' | 'summary';

export type GraphNode = { id: string; name: string; kind: GraphNodeKind };
export type GraphLink = { source: string; target: string; kind: GraphLinkKind };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

const ROOT_LABEL = 'Meu Drive';

// Pastas/arquivos que nunca aparecem no grafo, mesmo carregados/expandidos —
// ruído estrutural (config do próprio Obsidian, índices auto-gerados) que
// não ajuda a visualizar as ligações reais entre notas. Casamento por nome
// exato; uma pasta excluída esconde tudo dentro dela (nenhum filho seu chega
// a virar nó, então nada "solto" aparece por baixo dela).
const EXCLUDED_NAMES = new Set(['.obsidian', '00_AVALIACOES', 'CLAUDE.md', '_MOC.md']);

export function buildGraphData(state: VaultState): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const edgeKeys = new Set<string>();
  const summaryKeys = new Set<string>();
  const ghostIds = new Map<string, string>();

  const addNode = (id: string, name: string, kind: GraphNodeKind) => {
    if (!nodes.has(id)) nodes.set(id, { id, name, kind });
  };
  const addLink = (source: string, target: string, kind: GraphLinkKind) => {
    const key = `${kind}:${source}:${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    links.push({ source, target, kind });
  };

  if (state.rootId) addNode(state.rootId, ROOT_LABEL, 'folder');

  // Ids de pastas excluídas — descoberto varrendo TODAS as pastas já
  // listadas nesta sessão (não só as expandidas agora), pra que a exclusão
  // funcione independente da ordem de iteração de `expandedIds` a seguir.
  const excludedFolderIds = new Set<string>();
  for (const folder of state.folders.values()) {
    for (const child of folder.children) {
      if (child.isFolder && EXCLUDED_NAMES.has(child.name)) excludedFolderIds.add(child.id);
    }
  }
  // Ids de QUALQUER coisa excluída (pasta ou nota) — usado a seguir pra não
  // criar arestas de wikilink apontando pra um nó que nunca foi adicionado.
  const excludedIds = new Set(excludedFolderIds);

  // 1. Contenção — filhos de toda pasta atualmente expandida E carregada.
  //    `expandedIds` é um conjunto plano cobrindo qualquer profundidade, então
  //    isto cobre a árvore inteira sem precisar de recursão.
  for (const folderId of state.expandedIds) {
    if (excludedFolderIds.has(folderId)) continue; // não desce dentro de pasta excluída
    const folder = state.folders.get(folderId);
    if (!folder || folder.status !== 'loaded') continue;
    for (const child of folder.children) {
      if (EXCLUDED_NAMES.has(child.name)) {
        if (!child.isFolder) excludedIds.add(child.id);
        continue;
      }
      const kind: GraphNodeKind = child.isFolder ? 'folder' : isMarkdownFile(child) ? 'note' : 'file';
      addNode(child.id, child.name, kind);
      addLink(folderId, child.id, 'containment');
    }
  }

  // 2. Notas "soltas" (sem pasta-mãe conhecida) sempre aparecem — nunca são
  //    filhas de ninguém no passo 1, então precisam de emissão explícita.
  for (const [noteId, note] of state.notes.entries()) {
    if (note.parentFolderId !== undefined) continue;
    if (note.status !== 'loaded' && note.status !== 'saving') continue;
    if (EXCLUDED_NAMES.has(note.name)) {
      excludedIds.add(noteId);
      continue;
    }
    addNode(noteId, note.name || noteId, 'note');
  }

  // Índice de nomes a partir de TUDO já listado nesta sessão (não só o que
  // está expandido agora) — "foi descoberto nesta sessão", mesma convenção
  // dos backlinks da Fase 2. Notas soltas entram também: mesmo sem pasta
  // conhecida, uma vez carregadas elas têm nome e podem ser o alvo de um
  // wikilink de outra nota.
  const allListed: Array<{ id: string; name: string }> = [];
  for (const folder of state.folders.values()) allListed.push(...folder.children);
  for (const [noteId, n] of state.notes.entries()) {
    if (n.parentFolderId === undefined && n.name) allListed.push({ id: noteId, name: n.name });
  }
  const nameIndex = buildNameIndex(allListed);

  const resolveParent = (id: string): string | undefined => {
    const note = state.notes.get(id);
    if (note) return note.parentFolderId;
    return findParentFolderId(state.folders, id);
  };

  // 3. Arestas de wikilink — só a partir de notas carregadas e ATUALMENTE
  //    VISÍVEIS no grafo (nó já emitido pelos passos 1/2).
  for (const [noteId, note] of state.notes.entries()) {
    if (note.status !== 'loaded' && note.status !== 'saving') continue;
    if (!nodes.has(noteId)) continue;
    const sourceParentId = note.parentFolderId;

    for (const link of parseWikilinks(note.content)) {
      const targetId = resolveWikilinkTarget(nameIndex, link.target);

      if (!targetId) {
        const key = normalizeNoteName(link.target);
        let ghostId = ghostIds.get(key);
        if (!ghostId) {
          ghostId = `ghost:${key}`;
          ghostIds.set(key, ghostId);
          addNode(ghostId, link.target, 'ghost');
        }
        addLink(noteId, ghostId, 'wikilink');
        continue;
      }

      if (targetId === noteId) continue; // auto-link: sem auto-aresta
      if (excludedIds.has(targetId)) continue; // alvo escondido: nem aresta nem fantasma

      const targetParentId = resolveParent(targetId);
      // Direto quando: fonte solta, OU alvo solto, OU mesma pasta, OU ambas
      // as pastas expandidas agora. Note que "a pasta do alvo já foi
      // carregada ao menos uma vez" está implícito sempre que `targetId`
      // resolveu — só resolveu porque está listado como filho de
      // `targetParentId` em `state.folders`.
      const direct =
        sourceParentId === undefined ||
        targetParentId === undefined ||
        targetParentId === sourceParentId ||
        (state.expandedIds.has(sourceParentId) && state.expandedIds.has(targetParentId));

      if (direct) {
        addLink(noteId, targetId, 'wikilink');
      } else {
        const key = [sourceParentId, targetParentId].sort().join('::');
        if (!summaryKeys.has(key)) {
          summaryKeys.add(key);
          addLink(sourceParentId, targetParentId, 'summary');
        }
      }
    }
  }

  return { nodes: Array.from(nodes.values()), links };
}
