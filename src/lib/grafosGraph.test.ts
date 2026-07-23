import { describe, expect, it } from 'vitest';
import { buildGraphData, buildScopedGraphData, reconcileGraphNodes, type GraphLink, type GraphNode } from './grafosGraph';
import { initialVaultState, type FolderState, type NoteContentState, type VaultState } from './grafosTreeState';
import type { DriveNode } from './grafosNode';

function file(overrides: Partial<DriveNode> & { id: string; name: string }): DriveNode {
  return { mimeType: 'text/markdown', isFolder: false, ...overrides };
}

function folder(children: DriveNode[]): FolderState {
  return { status: 'loaded', children };
}

function note(overrides: Partial<NoteContentState> & { content: string }): NoteContentState {
  return {
    status: 'loaded',
    name: '',
    parentFolderId: undefined,
    loadedModifiedTime: 't1',
    dirty: false,
    ...overrides,
  };
}

function findLink(links: GraphLink[], source: string, target: string, kind: string) {
  return links.find((l) => l.source === source && l.target === target && l.kind === kind);
}

describe('buildGraphData', () => {
  it('sempre inclui o nó da raiz, mesmo com estado vazio', () => {
    const state: VaultState = { ...initialVaultState(), rootId: 'root' };
    const { nodes } = buildGraphData(state);
    expect(nodes).toEqual([{ id: 'root', name: 'Meu Drive', kind: 'folder' }]);
  });

  it('contenção só aparece para pastas expandidas e carregadas', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'p1', name: 'Projetos', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
      ]),
      expandedIds: new Set(['root']),
    };
    const { nodes, links } = buildGraphData(state);
    expect(nodes.find((n) => n.id === 'p1')).toMatchObject({ kind: 'folder' });
    expect(findLink(links, 'root', 'p1', 'containment')).toBeTruthy();
  });

  it('não mostra os filhos de uma pasta que existe mas não está expandida', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'p1', name: 'Projetos', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
        ['p1', folder([file({ id: 'n1', name: 'A.md' })])],
      ]),
      expandedIds: new Set(['root']), // p1 não está expandida
    };
    const { nodes } = buildGraphData(state);
    expect(nodes.find((n) => n.id === 'n1')).toBeUndefined();
  });

  it('aresta direta nota-a-nota quando ambas estão na mesma pasta', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'n1', name: 'A.md' }), file({ id: 'n2', name: 'B.md' })])],
      ]),
      expandedIds: new Set(['root']),
      notes: new Map([
        ['n1', note({ name: 'A.md', parentFolderId: 'root', content: 'veja [[B]]' })],
        ['n2', note({ name: 'B.md', parentFolderId: 'root', content: '' })],
      ]),
    };
    const { links } = buildGraphData(state);
    expect(findLink(links, 'n1', 'n2', 'wikilink')).toBeTruthy();
  });

  it('aresta direta quando as duas pastas envolvidas estão expandidas', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([
          file({ id: 'pA', name: 'A', mimeType: 'application/vnd.google-apps.folder', isFolder: true }),
          file({ id: 'pB', name: 'B', mimeType: 'application/vnd.google-apps.folder', isFolder: true }),
        ])],
        ['pA', folder([file({ id: 'n1', name: 'Nota A.md' })])],
        ['pB', folder([file({ id: 'n2', name: 'Nota B.md' })])],
      ]),
      expandedIds: new Set(['root', 'pA', 'pB']),
      notes: new Map([
        ['n1', note({ name: 'Nota A.md', parentFolderId: 'pA', content: 'veja [[Nota B]]' })],
      ]),
    };
    const { links } = buildGraphData(state);
    expect(findLink(links, 'n1', 'n2', 'wikilink')).toBeTruthy();
    expect(findLink(links, 'pA', 'pB', 'summary')).toBeUndefined();
  });

  it('aresta de resumo entre pastas quando uma delas não está expandida (mas já foi carregada)', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([
          file({ id: 'pA', name: 'A', mimeType: 'application/vnd.google-apps.folder', isFolder: true }),
          file({ id: 'pB', name: 'B', mimeType: 'application/vnd.google-apps.folder', isFolder: true }),
        ])],
        ['pA', folder([file({ id: 'n1', name: 'Nota A.md' })])],
        ['pB', folder([file({ id: 'n2', name: 'Nota B.md' })])],
      ]),
      // pB já foi carregada (existe em `folders`) mas não está expandida agora.
      expandedIds: new Set(['root', 'pA']),
      notes: new Map([
        ['n1', note({ name: 'Nota A.md', parentFolderId: 'pA', content: 'veja [[Nota B]]' })],
      ]),
    };
    const { links } = buildGraphData(state);
    expect(findLink(links, 'n1', 'n2', 'wikilink')).toBeUndefined();
    expect(findLink(links, 'pA', 'pB', 'summary')).toBeTruthy();
  });

  it('deduplica arestas de resumo entre o mesmo par de pastas', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([
          file({ id: 'pA', name: 'A', mimeType: 'application/vnd.google-apps.folder', isFolder: true }),
          file({ id: 'pB', name: 'B', mimeType: 'application/vnd.google-apps.folder', isFolder: true }),
        ])],
        ['pA', folder([file({ id: 'n1', name: 'N1.md' }), file({ id: 'n2', name: 'N2.md' })])],
        ['pB', folder([file({ id: 'n3', name: 'N3.md' }), file({ id: 'n4', name: 'N4.md' })])],
      ]),
      expandedIds: new Set(['root', 'pA']),
      notes: new Map([
        ['n1', note({ name: 'N1.md', parentFolderId: 'pA', content: 'veja [[N3]]' })],
        ['n2', note({ name: 'N2.md', parentFolderId: 'pA', content: 'veja [[N4]]' })],
      ]),
    };
    const { links } = buildGraphData(state);
    const summaryLinks = links.filter((l) => l.kind === 'summary');
    expect(summaryLinks).toHaveLength(1);
  });

  it('nó fantasma quando a pasta do alvo nunca foi carregada', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'n1', name: 'A.md' })])]]),
      expandedIds: new Set(['root']),
      notes: new Map([['n1', note({ name: 'A.md', parentFolderId: 'root', content: 'veja [[Referência X]]' })]]),
    };
    const { nodes, links } = buildGraphData(state);
    const ghost = nodes.find((n) => n.kind === 'ghost');
    expect(ghost).toMatchObject({ name: 'Referência X' });
    expect(findLink(links, 'n1', ghost!.id, 'wikilink')).toBeTruthy();
  });

  it('deduplica nós fantasma para o mesmo nome citado por notas diferentes', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'n1', name: 'A.md' }), file({ id: 'n2', name: 'B.md' })])]]),
      expandedIds: new Set(['root']),
      notes: new Map([
        ['n1', note({ name: 'A.md', parentFolderId: 'root', content: 'veja [[Fantasma]]' })],
        ['n2', note({ name: 'B.md', parentFolderId: 'root', content: 'também [[Fantasma]]' })],
      ]),
    };
    const { nodes } = buildGraphData(state);
    expect(nodes.filter((n) => n.kind === 'ghost')).toHaveLength(1);
  });

  it('nota solta como fonte sempre gera aresta direta', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'n2', name: 'B.md' })])]]),
      expandedIds: new Set(['root']),
      notes: new Map([
        ['n1', note({ name: 'Solta.md', parentFolderId: undefined, content: 'veja [[B]]' })],
      ]),
    };
    const { links } = buildGraphData(state);
    expect(findLink(links, 'n1', 'n2', 'wikilink')).toBeTruthy();
  });

  it('nota solta como alvo sempre gera aresta direta', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'n1', name: 'A.md' })])]]),
      expandedIds: new Set(['root']),
      notes: new Map([
        ['n1', note({ name: 'A.md', parentFolderId: 'root', content: 'veja [[Solta]]' })],
        ['n2', note({ name: 'Solta.md', parentFolderId: undefined, content: '' })],
      ]),
    };
    const { links } = buildGraphData(state);
    expect(findLink(links, 'n1', 'n2', 'wikilink')).toBeTruthy();
  });

  it('ignora auto-links (nota citando a si mesma)', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'n1', name: 'A.md' })])]]),
      expandedIds: new Set(['root']),
      notes: new Map([['n1', note({ name: 'A.md', parentFolderId: 'root', content: 'sobre [[A]]' })]]),
    };
    const { links } = buildGraphData(state);
    expect(links.filter((l) => l.kind === 'wikilink')).toHaveLength(0);
  });

  it('deduplica wikilinks repetidos pro mesmo alvo', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'n1', name: 'A.md' }), file({ id: 'n2', name: 'B.md' })])]]),
      expandedIds: new Set(['root']),
      notes: new Map([
        ['n1', note({ name: 'A.md', parentFolderId: 'root', content: '[[B]] e de novo [[B]]' })],
      ]),
    };
    const { links } = buildGraphData(state);
    expect(links.filter((l) => l.kind === 'wikilink')).toHaveLength(1);
  });

  describe('exclusão de pastas/arquivos ruído', () => {
    it('esconde a pasta ".grafos" e tudo dentro dela', () => {
      const state: VaultState = {
        ...initialVaultState(),
        rootId: 'root',
        folders: new Map([
          ['root', folder([file({ id: 'cfg', name: '.grafos', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
          ['cfg', folder([file({ id: 'plug', name: 'plugins', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
        ]),
        expandedIds: new Set(['root', 'cfg']),
      };
      const { nodes, links } = buildGraphData(state);
      expect(nodes.find((n) => n.id === 'cfg')).toBeUndefined();
      expect(nodes.find((n) => n.id === 'plug')).toBeUndefined();
      expect(links.find((l) => l.target === 'cfg')).toBeUndefined();
    });

    it('esconde a pasta "00_AVALIACOES"', () => {
      const state: VaultState = {
        ...initialVaultState(),
        rootId: 'root',
        folders: new Map([
          ['root', folder([file({ id: 'av', name: '00_AVALIACOES', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
        ]),
        expandedIds: new Set(['root']),
      };
      const { nodes } = buildGraphData(state);
      expect(nodes.find((n) => n.id === 'av')).toBeUndefined();
    });

    it('esconde arquivos "CLAUDE.md" e "_MOC.md"', () => {
      const state: VaultState = {
        ...initialVaultState(),
        rootId: 'root',
        folders: new Map([
          ['root', folder([
            file({ id: 'c1', name: 'CLAUDE.md' }),
            file({ id: 'm1', name: '_MOC.md' }),
            file({ id: 'n1', name: 'A.md' }),
          ])],
        ]),
        expandedIds: new Set(['root']),
      };
      const { nodes } = buildGraphData(state);
      expect(nodes.find((n) => n.id === 'c1')).toBeUndefined();
      expect(nodes.find((n) => n.id === 'm1')).toBeUndefined();
      expect(nodes.find((n) => n.id === 'n1')).toBeTruthy();
    });

    it('esconde nota solta com nome excluído', () => {
      const state: VaultState = {
        ...initialVaultState(),
        rootId: 'root',
        folders: new Map([['root', folder([])]]),
        expandedIds: new Set(['root']),
        notes: new Map([['m1', note({ name: '_MOC.md', parentFolderId: undefined, content: '' })]]),
      };
      const { nodes } = buildGraphData(state);
      expect(nodes.find((n) => n.id === 'm1')).toBeUndefined();
    });

    it('wikilink pra um alvo excluído não vira aresta nem nó fantasma', () => {
      const state: VaultState = {
        ...initialVaultState(),
        rootId: 'root',
        folders: new Map([
          ['root', folder([file({ id: 'n1', name: 'A.md' }), file({ id: 'm1', name: '_MOC.md' })])],
        ]),
        expandedIds: new Set(['root']),
        notes: new Map([['n1', note({ name: 'A.md', parentFolderId: 'root', content: 'veja [[_MOC]]' })]]),
      };
      const { nodes, links } = buildGraphData(state);
      expect(nodes.filter((n) => n.kind === 'ghost')).toHaveLength(0);
      expect(links.filter((l) => l.kind === 'wikilink')).toHaveLength(0);
    });
  });

  it('link pra arquivo não-markdown resolve normalmente (nó tipo file)', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'n1', name: 'A.md' }), file({ id: 'doc1', name: 'relatorio.pdf', mimeType: 'application/pdf' })])],
      ]),
      expandedIds: new Set(['root']),
      notes: new Map([['n1', note({ name: 'A.md', parentFolderId: 'root', content: 'veja [[relatorio.pdf]]' })]]),
    };
    const { nodes, links } = buildGraphData(state);
    expect(nodes.find((n) => n.id === 'doc1')).toMatchObject({ kind: 'file', mimeType: 'application/pdf' });
    expect(findLink(links, 'n1', 'doc1', 'wikilink')).toBeTruthy();
  });

  it('nó de pasta/nota não carrega mimeType de arquivo', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'n1', name: 'A.md' })])]]),
      expandedIds: new Set(['root']),
    };
    const { nodes } = buildGraphData(state);
    expect(nodes.find((n) => n.id === 'root')?.mimeType).toBeUndefined();
    expect(nodes.find((n) => n.id === 'n1')?.mimeType).toBe('text/markdown');
  });
});

describe('reconcileGraphNodes', () => {
  it('nó novo (cache vazio): usa o objeto como está e o guarda no cache', () => {
    const cache = new Map<string, GraphNode>();
    const fresh = { nodes: [{ id: 'a', name: 'A', kind: 'note' as const }], links: [] };
    const result = reconcileGraphNodes(fresh, cache);
    expect(result.nodes[0]).toBe(fresh.nodes[0]);
    expect(cache.get('a')).toBe(fresh.nodes[0]);
  });

  it('nó que já existia: reaproveita o MESMO objeto (preserva x/y simulados pela física)', () => {
    const cache = new Map<string, GraphNode>();
    const first = reconcileGraphNodes({ nodes: [{ id: 'a', name: 'A', kind: 'note' as const }], links: [] }, cache);
    const settledNode = first.nodes[0] as GraphNode & { x?: number; y?: number };
    // Simula a física do d3-force tendo assentado o nó num x/y qualquer.
    settledNode.x = 42;
    settledNode.y = 7;

    const second = reconcileGraphNodes({ nodes: [{ id: 'a', name: 'A (renomeada)', kind: 'note' as const }], links: [] }, cache);
    const reused = second.nodes[0] as GraphNode & { x?: number; y?: number };
    expect(reused).toBe(settledNode);
    expect(reused.x).toBe(42);
    expect(reused.y).toBe(7);
    expect(reused.name).toBe('A (renomeada)');
  });

  it('nó que sumiu (ex.: pasta recolhida) é descartado do cache — reaparece como novo', () => {
    const cache = new Map<string, GraphNode>();
    const first = reconcileGraphNodes({ nodes: [{ id: 'a', name: 'A', kind: 'note' as const }], links: [] }, cache);
    (first.nodes[0] as GraphNode & { x?: number }).x = 99;

    // 'a' não aparece nesta rodada (ex.: pasta-mãe recolhida).
    reconcileGraphNodes({ nodes: [], links: [] }, cache);
    expect(cache.has('a')).toBe(false);

    const third = reconcileGraphNodes({ nodes: [{ id: 'a', name: 'A', kind: 'note' as const }], links: [] }, cache);
    expect(third.nodes[0]).not.toBe(first.nodes[0]);
    expect((third.nodes[0] as GraphNode & { x?: number }).x).toBeUndefined();
  });

  it('links do resultado são sempre os mais recentes (não vêm do cache)', () => {
    const cache = new Map<string, GraphNode>();
    const links = [{ source: 'a', target: 'b', kind: 'containment' as const }];
    const result = reconcileGraphNodes(
      { nodes: [{ id: 'a', name: 'A', kind: 'folder' as const }, { id: 'b', name: 'B', kind: 'note' as const }], links },
      cache,
    );
    expect(result.links).toBe(links);
  });
});

describe('buildScopedGraphData', () => {
  it('mostra a pasta escolhida e seus filhos, independente de expandedIds', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'p1', name: 'Projetos', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
        ['p1', folder([file({ id: 'n1', name: 'A.md' })])],
      ]),
      expandedIds: new Set(), // nada expandido — não deveria importar aqui
    };
    const { nodes, links } = buildScopedGraphData(state, 'p1', 'Projetos');
    expect(nodes).toEqual([
      { id: 'p1', name: 'Projetos', kind: 'folder', mimeType: undefined },
      { id: 'n1', name: 'A.md', kind: 'note', mimeType: 'text/markdown' },
    ]);
    expect(findLink(links, 'p1', 'n1', 'containment')).toBeTruthy();
  });

  it('desce recursivamente por subpastas já carregadas', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'p1', name: 'Projetos', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
        ['p1', folder([file({ id: 'sub', name: 'Sub', mimeType: 'application/vnd.google-apps.folder', isFolder: true })])],
        ['sub', folder([file({ id: 'n1', name: 'A.md' })])],
      ]),
    };
    const { nodes, links } = buildScopedGraphData(state, 'p1', 'Projetos');
    expect(nodes.map((n) => n.id).sort()).toEqual(['n1', 'p1', 'sub']);
    expect(findLink(links, 'p1', 'sub', 'containment')).toBeTruthy();
    expect(findLink(links, 'sub', 'n1', 'containment')).toBeTruthy();
  });

  it('não mostra nada fora da pasta escolhida (nem a raiz do vault)', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        [
          'root',
          folder([
            file({ id: 'p1', name: 'Projetos', mimeType: 'application/vnd.google-apps.folder', isFolder: true }),
            file({ id: 'outside.md', name: 'Fora.md' }),
          ]),
        ],
        ['p1', folder([file({ id: 'n1', name: 'A.md' })])],
      ]),
    };
    const { nodes } = buildScopedGraphData(state, 'p1', 'Projetos');
    expect(nodes.some((n) => n.id === 'root')).toBe(false);
    expect(nodes.some((n) => n.id === 'outside.md')).toBe(false);
  });

  it('aresta de wikilink só aparece quando as duas pontas estão no escopo (sem fantasma pro que está fora)', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['p1', folder([file({ id: 'n1', name: 'A.md' }), file({ id: 'n2', name: 'B.md' })])]]),
      notes: new Map([
        ['n1', note({ name: 'A.md', parentFolderId: 'p1', content: '[[B]] [[Fora]]' })],
        ['n2', note({ name: 'B.md', parentFolderId: 'p1', content: '' })],
      ]),
    };
    const { nodes, links } = buildScopedGraphData(state, 'p1', 'Projetos');
    expect(nodes.some((n) => n.kind === 'ghost')).toBe(false);
    expect(findLink(links, 'n1', 'n2', 'wikilink')).toBeTruthy();
    expect(links.filter((l) => l.kind === 'wikilink')).toHaveLength(1);
  });
});
