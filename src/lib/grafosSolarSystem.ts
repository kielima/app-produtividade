import type { VaultState } from './grafosTreeState';
import { isMarkdownFile } from './grafosNode';
import { EXCLUDED_NAMES } from './grafosExcludedNames';

// Construtor puro da visualização "sistema solar" (releitura orbital da
// mesma hierarquia de contenção que a árvore já mostra) — sem React/canvas/
// rede, testável isoladamente (grafosSolarSystem.test.ts). Opera direto
// sobre VaultState, igual a grafosGraph.ts, mas com duas diferenças
// centrais em relação ao grafo:
//
// 1. Não lida com wikilinks/backlinks — só contenção pasta→filho. A
//    metáfora orbital (lua orbita planeta orbita estrela orbita buraco
//    negro) é puramente hierárquica.
// 2. NÃO é gated por `state.expandedIds` como `buildGraphData` — inclui os
//    filhos de QUALQUER pasta com `status === 'loaded'`, independente de
//    estar "expandida" na UI da árvore/grafo. Isso é o que permite ao
//    sistema solar mostrar o vault inteiro depois do crawl eager
//    (GrafosSolarSystemView.tsx dispara `vault.loadFolderChildren` pra
//    toda pasta recursivamente ao montar), sem depender de o usuário ter
//    clicado pra expandir nada. Árvore e grafo continuam gated por
//    `expandedIds` normalmente — esta é só mais uma leitura da mesma fonte.

// Papel estrutural que decide TAMANHO e COR — puramente função de
// profundidade (para pastas) ou "é arquivo?" (para luas). Nunca decide se
// algo orbita algo: isso é sempre pai imediato → filho, recursivo,
// independente de profundidade.
export type SolarBodyKind = 'blackhole' | 'star' | 'planet' | 'moon';

// Papel de DADOS — o que decide a interação ao clicar/segurar. Mesmo
// vocabulário de GraphNodeKind, menos 'ghost' (sem wikilinks aqui).
export type SolarDataKind = 'folder' | 'note' | 'file';

export type SolarNode = {
  id: string;
  name: string;
  mimeType?: string;
  dataKind: SolarDataKind;
  bodyKind: SolarBodyKind;
  parentId: string | null; // null só pra raiz (buraco negro)
  depth: number; // 0 = raiz
  siblingIndex: number; // índice entre os irmãos do MESMO shell (luas vs. corpos-filho)
  siblingCount: number; // total de irmãos nesse shell
  orbitRadius: number; // raio da órbita ao redor do pai, unidades de mundo
  orbitPhase: number; // ângulo inicial (rad), por índice/contagem de irmãos
  orbitSpeed: number; // velocidade angular (rad/s), decrescente com o raio
  // Mutados só pelo componente de renderização (nunca por
  // buildSolarSystemData nem por testes, exceto pra checar o valor inicial)
  // — inicializados aqui já "prontos pra animar" (angle = orbitPhase) sem
  // exigir um segundo objeto de estado.
  angle: number;
  x: number;
  y: number;
};

export type SolarLink = { source: string; target: string }; // contenção pai→filho
export type SolarSystemData = { nodes: SolarNode[]; links: SolarLink[] };

const ROOT_LABEL = 'Meu Drive';

// --- Constantes de layout (ponto de partida, ajustável ao ver renderizado —
// mesmo espírito do comentário sobre CARD_BASE_WIDTH em GrafosGraphView.tsx) ---
const BASE_BODY_RADIUS: Record<SolarBodyKind, number> = { blackhole: 10, star: 8, planet: 5, moon: 2.5 };
// Planeta encolhe levemente a cada nível de profundidade além do 2º
// (primeiro nível de planeta), clampado num piso pra não desaparecer.
const PLANET_SHRINK_FACTOR = 0.85;
const MIN_PLANET_RADIUS = 2.2;

const MOON_SPACING = 3;
const MOON_MIN_ORBIT = 6;
// Reserva de arco por lua proporcional ao nome do arquivo — sem isso, uma
// pasta com POUCOS arquivos (o caso que colapsa pro piso `MOON_MIN_ORBIT`,
// dimensionado só pra caber os CÍRCULOS lado a lado) deixava os RÓTULOS de
// texto se sobrepondo pesadamente: `packRadius`/`draw()` garantem que os
// círculos não colidem, mas nunca reservaram espaço pro texto (desenhado
// num tamanho fixo em pixels de tela, independente do zoom — ver
// LABEL_SCALE_THRESHOLD em GrafosSolarSystemView.tsx), que se estende bem
// além do raio de 2.5 unidades de uma lua. Heurística grosseira (não há
// medição real de fonte aqui, é layout puro sem canvas) — ajustar se ainda
// sobrepor com nomes muito compridos.
const MOON_LABEL_ARC_PER_CHAR = 2;
const MOON_LABEL_ARC_BASE = 6;
const PLANET_SPACING = 6;
const PLANET_GAP = 8; // garante que a shell de planetas nunca fica mais perto do centro que a de luas
const ANGULAR_SPEED_K = 0.6; // rad·raio^0.5/s
const MIN_SPEED = 0.02;
const MAX_SPEED = 0.9;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// Garante que a circunferência da shell (2πraio) comporta `count` corpos
// lado a lado sem sobrepor, cada um ocupando uma "fatia" de arco de
// `2*bodyRadius + spacing`.
function packRadius(count: number, bodyRadius: number, spacing: number, minRadius: number): number {
  if (count <= 0) return 0;
  return Math.max(minRadius, (count * (2 * bodyRadius + spacing)) / (2 * Math.PI));
}

// Arco reservado pra UMA lua — o maior entre "cabe o círculo" (mesma conta
// de `packRadius`) e "cabe o nome" (heurística por comprimento, ver
// MOON_LABEL_ARC_PER_CHAR acima). Nomes curtos não mudam nada (o círculo já
// dominava); nomes compridos em pastas com poucos arquivos são o caso que
// isto corrige.
function moonArcFor(name: string): number {
  const circleArc = 2 * BASE_BODY_RADIUS.moon + MOON_SPACING;
  const labelArc = name.length * MOON_LABEL_ARC_PER_CHAR + MOON_LABEL_ARC_BASE;
  return Math.max(circleArc, labelArc);
}

// Mesma ideia de `packRadius`, mas somando o arco INDIVIDUAL de cada lua
// (via `moonArcFor`) em vez de multiplicar um arco uniforme pela contagem —
// necessário porque luas têm nomes de comprimentos bem diferentes entre si,
// ao contrário de planetas/estrelas (cujo "arco" já vem do maior `extent`
// entre os irmãos, ver computeExtent).
function packMoonRadius(moons: SolarNode[], minRadius: number): number {
  if (moons.length === 0) return 0;
  const totalArc = moons.reduce((sum, m) => sum + moonArcFor(m.name), 0);
  return Math.max(minRadius, totalArc / (2 * Math.PI));
}

// Exportado para o componente de renderização (GrafosSolarSystemView.tsx)
// desenhar/testar-hit corpos com o MESMO raio usado aqui no empacotamento —
// se divergissem, órbitas calculadas como "sem colisão" poderiam parecer
// colidir visualmente (ou vice-versa).
export function bodyRadiusFor(bodyKind: SolarBodyKind, depth: number): number {
  if (bodyKind !== 'planet') return BASE_BODY_RADIUS[bodyKind];
  const shrinkSteps = Math.max(0, depth - 2);
  return Math.max(MIN_PLANET_RADIUS, BASE_BODY_RADIUS.planet * Math.pow(PLANET_SHRINK_FACTOR, shrinkSteps));
}

// Kepler simplificado (∝ 1/√raio) — só estética ("longe = lento"), não
// física real. `clamp` evita órbitas giratórias demais perto do centro e
// quase paradas nas mais externas.
function orbitSpeedFor(orbitRadius: number): number {
  return clamp(ANGULAR_SPEED_K / Math.sqrt(orbitRadius || 1), MIN_SPEED, MAX_SPEED);
}

// Pequeno deslocamento determinístico por pasta, pra que shells irmãs em
// pastas diferentes não fiquem todas alinhadas no ângulo 0 — puramente
// estético, evita um padrão radial repetitivo.
function hashStringToUnitFloat(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

function newNode(
  id: string,
  name: string,
  mimeType: string | undefined,
  dataKind: SolarDataKind,
  bodyKind: SolarBodyKind,
  parentId: string | null,
  depth: number,
): SolarNode {
  return {
    id,
    name,
    mimeType,
    dataKind,
    bodyKind,
    parentId,
    depth,
    siblingIndex: 0,
    siblingCount: 1,
    orbitRadius: 0,
    orbitPhase: 0,
    orbitSpeed: 0,
    angle: 0,
    x: 0,
    y: 0,
  };
}

export function buildSolarSystemData(state: VaultState): SolarSystemData {
  if (!state.rootId) return { nodes: [], links: [] };
  const rootId = state.rootId;

  const nodesById = new Map<string, SolarNode>();
  const childrenByParent = new Map<string, SolarNode[]>();

  nodesById.set(rootId, newNode(rootId, ROOT_LABEL, undefined, 'folder', 'blackhole', null, 0));

  // Percorre toda pasta CARREGADA (não gated por expandedIds, ver comentário
  // no topo do arquivo) — pastas ainda não carregadas simplesmente não
  // contribuem filhos ainda (o crawl eager do componente vai chegar nelas).
  function visitFolder(folderId: string) {
    const folder = state.folders.get(folderId);
    if (!folder || folder.status !== 'loaded') return;
    const parentDepth = nodesById.get(folderId)?.depth ?? 0;
    const list: SolarNode[] = [];
    for (const child of folder.children) {
      if (EXCLUDED_NAMES.has(child.name)) continue; // cobre pasta e arquivo excluído; nunca desce dentro de pasta excluída
      if (nodesById.has(child.id)) continue; // já descoberto (segurança contra duplicata)
      const childDepth = parentDepth + 1;
      const dataKind: SolarDataKind = child.isFolder ? 'folder' : isMarkdownFile(child) ? 'note' : 'file';
      const bodyKind: SolarBodyKind = child.isFolder ? (childDepth === 1 ? 'star' : 'planet') : 'moon';
      const node = newNode(child.id, child.name, child.mimeType, dataKind, bodyKind, folderId, childDepth);
      nodesById.set(child.id, node);
      list.push(node);
      if (child.isFolder) visitFolder(child.id);
    }
    childrenByParent.set(folderId, list);
  }
  visitFolder(rootId);

  // Notas "soltas" (sem pasta-mãe conhecida, ex. descobertas via busca) —
  // orbitam o buraco negro diretamente como luas de profundidade 1, pra que
  // nada fique de fora do mapa completo por não ter pasta-mãe conhecida no
  // momento. Entram no MESMO shell de luas da raiz que arquivos diretos
  // dela (mesma lista em `childrenByParent`), sem lógica de layout à parte.
  for (const [noteId, note] of state.notes.entries()) {
    if (note.parentFolderId !== undefined) continue;
    if (note.status !== 'loaded' && note.status !== 'saving') continue;
    if (EXCLUDED_NAMES.has(note.name)) continue;
    if (nodesById.has(noteId)) continue;
    const node = newNode(noteId, note.name || noteId, undefined, 'note', 'moon', rootId, 1);
    nodesById.set(noteId, node);
    const list = childrenByParent.get(rootId) ?? [];
    list.push(node);
    childrenByParent.set(rootId, list);
  }

  // --- Layout orbital: post-order (extent) + pré-order (atribuição) ---
  // `shellRadii` guarda, por pasta, o raio das duas shells concêntricas
  // (luas mais internas, corpos-filho mais externos) calculado no post-order
  // abaixo — reaproveitado na atribuição final sem refazer a recursão.
  const shellRadii = new Map<string, { moonShellRadius: number; planetShellRadius: number }>();

  // `extent` = raio da menor circunferência que envolve o nó E toda a sua
  // subárvore já desenhada — o `extent` de uma subpasta já embute o espaço
  // de TODOS os seus descendentes, então usá-lo (via `maxChildExtent`) para
  // dimensionar a shell de planetas do pai garante, por indução, que
  // subárvores vizinhas nunca colidem (mesmo argumento de correção de
  // layouts radiais tipo sunburst/icicle recursivo).
  function computeExtent(nodeId: string): number {
    const node = nodesById.get(nodeId);
    if (!node) return 0;
    const children = childrenByParent.get(nodeId) ?? [];
    if (children.length === 0) return bodyRadiusFor(node.bodyKind, node.depth);

    const fileChildren = children.filter((c) => c.dataKind !== 'folder');
    const folderChildren = children.filter((c) => c.dataKind === 'folder');
    const moonShellRadius = packMoonRadius(fileChildren, MOON_MIN_ORBIT);

    let maxChildExtent = 0;
    for (const fc of folderChildren) {
      const e = computeExtent(fc.id);
      if (e > maxChildExtent) maxChildExtent = e;
    }
    const planetShellRadius = packRadius(
      folderChildren.length,
      maxChildExtent,
      PLANET_SPACING,
      moonShellRadius + PLANET_GAP,
    );
    shellRadii.set(nodeId, { moonShellRadius, planetShellRadius });

    return folderChildren.length > 0 ? planetShellRadius + maxChildExtent : moonShellRadius + BASE_BODY_RADIUS.moon;
  }
  computeExtent(rootId);

  // Segunda passada: distribui ângulo/velocidade de cada filho dentro do
  // shell já dimensionado pelo pai.
  for (const [folderId, shells] of shellRadii) {
    const children = childrenByParent.get(folderId) ?? [];
    const fileChildren = children.filter((c) => c.dataKind !== 'folder');
    const folderChildren = children.filter((c) => c.dataKind === 'folder');
    const offset = hashStringToUnitFloat(folderId) * 2 * Math.PI;

    fileChildren.forEach((c, i) => {
      c.orbitRadius = shells.moonShellRadius;
      c.siblingIndex = i;
      c.siblingCount = fileChildren.length;
      c.orbitPhase = (2 * Math.PI * i) / fileChildren.length + offset;
      c.orbitSpeed = orbitSpeedFor(shells.moonShellRadius);
      c.angle = c.orbitPhase;
    });
    folderChildren.forEach((c, i) => {
      c.orbitRadius = shells.planetShellRadius;
      c.siblingIndex = i;
      c.siblingCount = folderChildren.length;
      c.orbitPhase = (2 * Math.PI * i) / folderChildren.length + offset;
      c.orbitSpeed = orbitSpeedFor(shells.planetShellRadius);
      c.angle = c.orbitPhase;
    });
  }

  const nodes = Array.from(nodesById.values());
  const links: SolarLink[] = nodes
    .filter((n): n is SolarNode & { parentId: string } => n.parentId !== null)
    .map((n) => ({ source: n.parentId, target: n.id }));

  return { nodes, links };
}

// `buildSolarSystemData` acima monta objetos de nó NOVOS a cada chamada — o
// componente de renderização (GrafosSolarSystemView.tsx) precisa do MESMO
// objeto JS por id entre recomputações pra não perder o `angle` acumulado
// pela animação (o crawl eager dispara MUITAS atualizações de
// `vault.state` em sequência enquanto o mapa cresce; sem isso, cada uma
// resetaria o ângulo de tudo que já estava girando). Mesmo padrão de
// `reconcileGraphNodes` em grafosGraph.ts, só que o campo crítico
// preservado aqui é `angle` (x/y são recalculados a cada frame pelo
// componente a partir do ângulo + posição do pai, não precisam sobreviver).
export function reconcileSolarNodes(
  fresh: SolarSystemData,
  cache: Map<string, SolarNode>,
): SolarSystemData {
  const seenIds = new Set<string>();
  const nodes = fresh.nodes.map((n) => {
    seenIds.add(n.id);
    const existing = cache.get(n.id);
    if (existing) {
      existing.name = n.name;
      existing.mimeType = n.mimeType;
      existing.dataKind = n.dataKind;
      existing.bodyKind = n.bodyKind;
      existing.parentId = n.parentId;
      existing.depth = n.depth;
      existing.siblingIndex = n.siblingIndex;
      existing.siblingCount = n.siblingCount;
      existing.orbitRadius = n.orbitRadius;
      existing.orbitPhase = n.orbitPhase;
      existing.orbitSpeed = n.orbitSpeed;
      return existing; // angle/x/y intocados
    }
    cache.set(n.id, n);
    return n;
  });
  for (const id of cache.keys()) {
    if (!seenIds.has(id)) cache.delete(id);
  }
  return { nodes, links: fresh.links };
}
