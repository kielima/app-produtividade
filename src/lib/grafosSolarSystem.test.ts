import { describe, expect, it } from 'vitest';
import {
  buildSolarSystemData,
  reconcileSolarNodes,
  type SolarNode,
  type SolarSystemData,
} from './grafosSolarSystem';
import { initialVaultState, type FolderState, type NoteContentState, type VaultState } from './grafosTreeState';
import type { DriveNode } from './grafosNode';

function file(overrides: Partial<DriveNode> & { id: string; name: string }): DriveNode {
  return { mimeType: 'text/markdown', isFolder: false, ...overrides };
}

function folderDriveNode(overrides: Partial<DriveNode> & { id: string; name: string }): DriveNode {
  return { mimeType: 'application/vnd.google-apps.folder', isFolder: true, ...overrides };
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

function byId(data: SolarSystemData, id: string): SolarNode | undefined {
  return data.nodes.find((n) => n.id === id);
}

describe('buildSolarSystemData', () => {
  it('devolve nada se ainda não há raiz', () => {
    expect(buildSolarSystemData(initialVaultState())).toEqual({ nodes: [], links: [] });
  });

  it('a raiz vira buraco negro (depth 0, sem pai)', () => {
    const state: VaultState = { ...initialVaultState(), rootId: 'root' };
    const { nodes } = buildSolarSystemData(state);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: 'root', bodyKind: 'blackhole', dataKind: 'folder', depth: 0, parentId: null });
  });

  it('filho direto da raiz vira estrela', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([folderDriveNode({ id: 'p1', name: 'Projetos' })])]]),
    };
    const { nodes } = buildSolarSystemData(state);
    expect(byId({ nodes, links: [] }, 'p1')).toMatchObject({ bodyKind: 'star', dataKind: 'folder', depth: 1, parentId: 'root' });
  });

  it('neto vira planeta', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([folderDriveNode({ id: 'p1', name: 'A' })])],
        ['p1', folder([folderDriveNode({ id: 'p2', name: 'B' })])],
      ]),
    };
    const { nodes } = buildSolarSystemData(state);
    expect(byId({ nodes, links: [] }, 'p2')).toMatchObject({ bodyKind: 'planet', depth: 2, parentId: 'p1' });
  });

  it('bisneto também é planeta — sem teto de 3 níveis', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([folderDriveNode({ id: 'p1', name: 'A' })])],
        ['p1', folder([folderDriveNode({ id: 'p2', name: 'B' })])],
        ['p2', folder([folderDriveNode({ id: 'p3', name: 'C' })])],
      ]),
    };
    const { nodes } = buildSolarSystemData(state);
    expect(byId({ nodes, links: [] }, 'p3')).toMatchObject({ bodyKind: 'planet', depth: 3, parentId: 'p2' });
  });

  it('arquivo é sempre lua, em qualquer profundidade do pai', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'f1', name: 'A.md' }), folderDriveNode({ id: 'p1', name: 'P1' })])],
        ['p1', folder([folderDriveNode({ id: 'p2', name: 'P2' })])],
        ['p2', folder([folderDriveNode({ id: 'p3', name: 'P3' })])],
        ['p3', folder([file({ id: 'f2', name: 'Fundo.md' })])],
      ]),
    };
    const { nodes } = buildSolarSystemData(state);
    const data = { nodes, links: [] };
    expect(byId(data, 'f1')).toMatchObject({ bodyKind: 'moon', depth: 1 });
    expect(byId(data, 'f2')).toMatchObject({ bodyKind: 'moon', depth: 4, parentId: 'p3' });
  });

  it('pasta carregada mas NÃO expandida ainda contribui filhos (independente de expandedIds)', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([folderDriveNode({ id: 'p1', name: 'Projetos' })])],
        ['p1', folder([file({ id: 'n1', name: 'A.md' })])],
      ]),
      expandedIds: new Set(), // nada expandido — o grafo/árvore não mostrariam n1, o sistema solar mostra
    };
    const { nodes } = buildSolarSystemData(state);
    expect(byId({ nodes, links: [] }, 'n1')).toMatchObject({ parentId: 'p1' });
  });

  it('pasta nunca carregada não contribui filhos', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([folderDriveNode({ id: 'p1', name: 'Projetos' })])]]),
      // 'p1' nunca aparece em state.folders — nunca foi buscado.
    };
    const { nodes } = buildSolarSystemData(state);
    expect(nodes.map((n) => n.id).sort()).toEqual(['p1', 'root']);
  });

  it('nota solta orbita o buraco negro como lua de profundidade 1', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([])]]),
      notes: new Map([['n1', note({ name: 'Solta.md', parentFolderId: undefined, content: '' })]]),
    };
    const { nodes } = buildSolarSystemData(state);
    expect(byId({ nodes, links: [] }, 'n1')).toMatchObject({ dataKind: 'note', bodyKind: 'moon', parentId: 'root', depth: 1 });
  });

  describe('exclusão de pastas/arquivos ruído', () => {
    it('esconde a pasta ".grafos" e tudo dentro dela', () => {
      const state: VaultState = {
        ...initialVaultState(),
        rootId: 'root',
        folders: new Map([
          ['root', folder([folderDriveNode({ id: 'cfg', name: '.grafos' })])],
          ['cfg', folder([folderDriveNode({ id: 'plug', name: 'plugins' })])],
        ]),
      };
      const { nodes } = buildSolarSystemData(state);
      expect(nodes.find((n) => n.id === 'cfg')).toBeUndefined();
      expect(nodes.find((n) => n.id === 'plug')).toBeUndefined();
    });

    it('esconde arquivos "CLAUDE.md" e "_MOC.md", mantém nota normal', () => {
      const state: VaultState = {
        ...initialVaultState(),
        rootId: 'root',
        folders: new Map([
          [
            'root',
            folder([
              file({ id: 'c1', name: 'CLAUDE.md' }),
              file({ id: 'm1', name: '_MOC.md' }),
              file({ id: 'n1', name: 'A.md' }),
            ]),
          ],
        ]),
      };
      const { nodes } = buildSolarSystemData(state);
      expect(nodes.find((n) => n.id === 'c1')).toBeUndefined();
      expect(nodes.find((n) => n.id === 'm1')).toBeUndefined();
      expect(nodes.find((n) => n.id === 'n1')).toBeTruthy();
    });
  });

  it('camadas orbitais não colidem: shell de planetas fica estritamente mais longe que a de luas', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([file({ id: 'f1', name: 'A.md' }), folderDriveNode({ id: 'p1', name: 'P1' })])],
      ]),
    };
    const { nodes } = buildSolarSystemData(state);
    const data = { nodes, links: [] };
    const f1 = byId(data, 'f1')!;
    const p1 = byId(data, 'p1')!;
    expect(p1.orbitRadius).toBeGreaterThan(f1.orbitRadius);
  });

  it('subárvore com muitos netos empurra a órbita da subpasta pra mais longe do pai', () => {
    const smallState: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([folderDriveNode({ id: 'p1', name: 'P1' })])],
        ['p1', folder([folderDriveNode({ id: 'q1', name: 'Q1' })])],
      ]),
    };
    const bigChildren = Array.from({ length: 10 }, (_, i) => folderDriveNode({ id: `q${i}`, name: `Q${i}` }));
    const bigState: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        ['root', folder([folderDriveNode({ id: 'p1', name: 'P1' })])],
        ['p1', folder(bigChildren)],
      ]),
    };
    const small = buildSolarSystemData(smallState);
    const big = buildSolarSystemData(bigState);
    const smallP1 = byId(small, 'p1')!;
    const bigP1 = byId(big, 'p1')!;
    expect(bigP1.orbitRadius).toBeGreaterThan(smallP1.orbitRadius);
  });

  it('distribui o ângulo dos irmãos por índice/contagem (espaçamento uniforme)', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([
        [
          'root',
          folder([
            file({ id: 'f1', name: 'A.md' }),
            file({ id: 'f2', name: 'B.md' }),
            file({ id: 'f3', name: 'C.md' }),
          ]),
        ],
      ]),
    };
    const { nodes } = buildSolarSystemData(state);
    const data = { nodes, links: [] };
    const phases = ['f1', 'f2', 'f3'].map((id) => byId(data, id)!.siblingIndex);
    expect(phases.sort((a, b) => a - b)).toEqual([0, 1, 2]);
    const sorted = ['f1', 'f2', 'f3']
      .map((id) => byId(data, id)!)
      .sort((a, b) => a.siblingIndex - b.siblingIndex);
    const expectedStep = (2 * Math.PI) / 3;
    expect(sorted[1].orbitPhase - sorted[0].orbitPhase).toBeCloseTo(expectedStep, 5);
    expect(sorted[2].orbitPhase - sorted[1].orbitPhase).toBeCloseTo(expectedStep, 5);
  });

  it('link de contenção pai→filho é emitido pra todo nó não-raiz', () => {
    const state: VaultState = {
      ...initialVaultState(),
      rootId: 'root',
      folders: new Map([['root', folder([file({ id: 'f1', name: 'A.md' })])]]),
    };
    const { links } = buildSolarSystemData(state);
    expect(links).toEqual([{ source: 'root', target: 'f1' }]);
  });
});

describe('reconcileSolarNodes', () => {
  it('nó novo (cache vazio): usa o objeto como está e o guarda no cache', () => {
    const cache = new Map<string, SolarNode>();
    const fresh: SolarSystemData = {
      nodes: [
        {
          id: 'a',
          name: 'A',
          dataKind: 'note',
          bodyKind: 'moon',
          parentId: 'root',
          depth: 1,
          siblingIndex: 0,
          siblingCount: 1,
          orbitRadius: 10,
          orbitPhase: 0.5,
          orbitSpeed: 0.3,
          angle: 0.5,
          x: 0,
          y: 0,
        },
      ],
      links: [],
    };
    const result = reconcileSolarNodes(fresh, cache);
    expect(result.nodes[0]).toBe(fresh.nodes[0]);
    expect(cache.get('a')).toBe(fresh.nodes[0]);
  });

  it('nó que já existia: reaproveita o MESMO objeto e preserva o ângulo animado', () => {
    const cache = new Map<string, SolarNode>();
    const base = (orbitRadius: number): SolarSystemData => ({
      nodes: [
        {
          id: 'a',
          name: 'A',
          dataKind: 'note',
          bodyKind: 'moon',
          parentId: 'root',
          depth: 1,
          siblingIndex: 0,
          siblingCount: 1,
          orbitRadius,
          orbitPhase: 0,
          orbitSpeed: 0.3,
          angle: 0,
          x: 0,
          y: 0,
        },
      ],
      links: [],
    });

    const first = reconcileSolarNodes(base(10), cache);
    // Simula o loop de animação tendo avançado o ângulo do nó.
    first.nodes[0].angle = 1.23;
    first.nodes[0].x = 42;
    first.nodes[0].y = 7;

    const second = reconcileSolarNodes(base(25), cache); // orbitRadius mudou (ex.: novo irmão apareceu)
    expect(second.nodes[0]).toBe(first.nodes[0]);
    expect(second.nodes[0].angle).toBe(1.23); // preservado
    expect(second.nodes[0].orbitRadius).toBe(25); // atualizado
  });

  it('nó que sumiu é descartado do cache — reaparece como novo (ângulo resetado)', () => {
    const cache = new Map<string, SolarNode>();
    const node = (): SolarSystemData => ({
      nodes: [
        {
          id: 'a',
          name: 'A',
          dataKind: 'note',
          bodyKind: 'moon',
          parentId: 'root',
          depth: 1,
          siblingIndex: 0,
          siblingCount: 1,
          orbitRadius: 10,
          orbitPhase: 0.5,
          orbitSpeed: 0.3,
          angle: 0.5,
          x: 0,
          y: 0,
        },
      ],
      links: [],
    });
    const first = reconcileSolarNodes(node(), cache);
    first.nodes[0].angle = 9.9;

    reconcileSolarNodes({ nodes: [], links: [] }, cache); // 'a' some (ex.: pai recolhido/removido)
    expect(cache.has('a')).toBe(false);

    const third = reconcileSolarNodes(node(), cache);
    expect(third.nodes[0]).not.toBe(first.nodes[0]);
    expect(third.nodes[0].angle).toBe(0.5); // valor "de fábrica", não o 9.9 acumulado antes
  });

  it('links do resultado são sempre os mais recentes (não vêm do cache)', () => {
    const cache = new Map<string, SolarNode>();
    const links = [{ source: 'root', target: 'a' }];
    const result = reconcileSolarNodes(
      {
        nodes: [
          {
            id: 'a',
            name: 'A',
            dataKind: 'note',
            bodyKind: 'moon',
            parentId: 'root',
            depth: 1,
            siblingIndex: 0,
            siblingCount: 1,
            orbitRadius: 10,
            orbitPhase: 0,
            orbitSpeed: 0.3,
            angle: 0,
            x: 0,
            y: 0,
          },
        ],
        links,
      },
      cache,
    );
    expect(result.links).toBe(links);
  });
});
