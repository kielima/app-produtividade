import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSolarSystemData,
  reconcileSolarNodes,
  bodyRadiusFor,
  type SolarNode,
} from '../lib/grafosSolarSystem';
import { EXCLUDED_NAMES } from '../lib/grafosExcludedNames';
import { useThemeColors, type CssVarReader } from '../lib/grafosColors';
import { useThrottledValue } from '../lib/useThrottledValue';
import { driveIconKind } from '../lib/driveFileIcons';
import { buildRenamedFileName, stripMdExtension } from '../lib/grafosWikilink';
import type { useGrafosVault } from '../lib/grafosTree';
import type { DriveNode } from '../lib/grafosNode';
import { GrafosNoteGraphCard } from './GrafosNoteGraphCard';
import { GrafosFilePreviewCard } from './GrafosFilePreviewCard';
import { GrafosHtmlViewerDialog } from './GrafosHtmlViewerDialog';
import { GrafosRenameDialog } from './GrafosRenameDialog';
import { GrafosMoveDialog } from './GrafosMoveDialog';

type Vault = ReturnType<typeof useGrafosVault>;

// Quantas pastas o carregamento de UM NÍVEL pode buscar em paralelo — alto
// o bastante pra um nível carregar rápido, baixo o bastante pra não
// disparar dezenas de requisições simultâneas ao Drive de uma vez (ver
// loadLevel no componente abaixo).
const MAX_CONCURRENT_FOLDER_LOADS = 4;

// Backoff pra falhas transitórias (rate limit, erro 500 "internal" etc.)
// durante o carregamento de um nível — ver loadFolderChildrenWithRetry.
const RETRY_DELAYS_MS = [500, 1500, 4000];

// Mesmos valores de GrafosGraphView.tsx — long-press (touch) detectado na
// mão porque `contextmenu` nativo não dispara de forma confiável no WebView
// Android (ver comentário lá).
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const ZOOM_BUTTON_FACTOR = 1.3;
const LABEL_SCALE_THRESHOLD = 0.9;

// O crawl eager dispara ~2 dispatches de estado por pasta carregada
// (grafosTree.ts) — sem throttle, `buildSolarSystemData` recalcularia a
// árvore INTEIRA já conhecida a cada uma dessas mudanças (O(N²) no total
// pra N pastas). Amostrar `vault.state` no máximo a cada
// SOLAR_DATA_THROTTLE_MS limita o número de recomputações à duração do
// crawl dividida por esse intervalo, independente de N — ver
// useThrottledValue.ts.
const SOLAR_DATA_THROTTLE_MS = 350;

// Mesmas unidades/valores usados no cartão de preview do grafo (ver
// GrafosGraphView.tsx) — ponto de partida ainda não validado com um vault
// real, ajustar ao ver renderizado.
const CARD_BASE_WIDTH = 27.5;
const CARD_BASE_FONT_SIZE = 1.25;
const A4_RATIO = 297 / 210;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// --- Paleta específica do sistema solar, via os utilitários genéricos de
// grafosColors.ts (compartilhados com o grafo, que tem sua própria paleta/
// shape). ---
type SolarColors = {
  blackhole: string;
  blackholeGlow: string;
  star: string;
  starGlow: string;
  planet: string;
  moon: string;
  orbitLine: string;
  label: string;
  labelHalo: string;
};

function resolveSolarColorsFrom(read: CssVarReader): SolarColors {
  return {
    blackhole: read('--solar-blackhole', '#0b0b12'),
    blackholeGlow: read('--solar-blackhole-glow', 'rgba(120,90,255,.35)'),
    star: read('--solar-star', '#ffb703'),
    starGlow: read('--solar-star-glow', 'rgba(255,183,3,.4)'),
    planet: read('--solar-planet', '#2f8f8f'),
    moon: read('--solar-moon', '#9a9a9a'),
    orbitLine: read('--solar-orbit-line', 'rgba(0,0,0,.12)'),
    label: read('--fg', '#1a1a1a'),
    labelHalo: read('--bg', '#fafafa'),
  };
}

function useSolarColors(): SolarColors {
  return useThemeColors(resolveSolarColorsFrom);
}

type Camera = { x: number; y: number; scale: number };

function worldToScreen(camera: Camera, w: number, h: number, wx: number, wy: number) {
  return { x: wx * camera.scale + camera.x + w / 2, y: wy * camera.scale + camera.y + h / 2 };
}

function screenToWorld(camera: Camera, w: number, h: number, sx: number, sy: number) {
  return { x: (sx - camera.x - w / 2) / camera.scale, y: (sy - camera.y - h / 2) / camera.scale };
}

// Avança o ângulo orbital de cada corpo — raiz (parentId null) nunca se
// move. `angle` é preservado entre recomputações por `reconcileSolarNodes`,
// então isto nunca "reseta" a animação de quem já estava girando.
function advanceAngles(nodes: SolarNode[], dt: number) {
  for (const n of nodes) {
    if (n.parentId != null) n.angle = (n.angle + n.orbitSpeed * dt) % (2 * Math.PI);
  }
}

// Resolve x/y mundo de cada nó a partir do ângulo atual + posição do PAI —
// memoizado por frame (`resolved`) pra funcionar independente da ordem do
// array (embora `buildSolarSystemData` já visite pai antes de filho).
function computeWorldPositions(nodes: SolarNode[], nodesById: Map<string, SolarNode>) {
  const resolved = new Set<string>();
  function resolve(n: SolarNode) {
    if (resolved.has(n.id)) return;
    resolved.add(n.id);
    if (n.parentId == null) {
      n.x = 0;
      n.y = 0;
      return;
    }
    const parent = nodesById.get(n.parentId);
    if (!parent) {
      n.x = 0;
      n.y = 0;
      return;
    }
    resolve(parent);
    n.x = parent.x + n.orbitRadius * Math.cos(n.angle);
    n.y = parent.y + n.orbitRadius * Math.sin(n.angle);
  }
  for (const n of nodes) resolve(n);
}

function bodyFillColor(node: SolarNode, colors: SolarColors): string {
  switch (node.bodyKind) {
    case 'blackhole':
      return colors.blackhole;
    case 'star':
      return colors.star;
    case 'planet':
      return colors.planet;
    default:
      return colors.moon;
  }
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  radiusPx: number,
  node: SolarNode,
  colors: SolarColors,
) {
  if (node.bodyKind === 'blackhole') {
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, radiusPx * 3);
    gradient.addColorStop(0, colors.blackholeGlow);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(screenX, screenY, radiusPx * 3, 0, 2 * Math.PI);
    ctx.fillStyle = gradient;
    ctx.fill();
  } else if (node.bodyKind === 'star') {
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, radiusPx * 2.2);
    gradient.addColorStop(0, colors.starGlow);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(screenX, screenY, radiusPx * 2.2, 0, 2 * Math.PI);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(screenX, screenY, radiusPx, 0, 2 * Math.PI);
  ctx.fillStyle = bodyFillColor(node, colors);
  ctx.fill();
}

// Margem extra além do raio de um corpo/anel pra decidir se ele toca a
// tela — cobre o rótulo de texto (que se estende além do círculo) e evita
// um "pop" perceptível bem na borda do canvas.
const CULL_MARGIN_PX = 80;

// Testa se um círculo (raio `r`, centro em coordenadas de TELA) toca o
// retângulo `[0,w] x [0,h]` do canvas — distância do centro até o ponto
// mais próximo do retângulo, comparada ao raio. Usado pra não desenhar
// (nem gastar `ctx.arc`/`fillText`) anéis/corpos totalmente fora da vista,
// o que importa em mapas com muitos nós e o usuário com zoom aplicado (só
// uma fração do mapa realmente visível por vez).
function circleOnScreen(cx: number, cy: number, r: number, w: number, h: number): boolean {
  const closestX = clamp(cx, 0, w);
  const closestY = clamp(cy, 0, h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

function draw(
  canvas: HTMLCanvasElement | null,
  nodes: SolarNode[],
  nodesById: Map<string, SolarNode>,
  visibleIds: Set<string>,
  camera: Camera,
  size: { w: number; h: number },
  colors: SolarColors,
  previewId: string | null,
) {
  if (!canvas || size.w === 0 || size.h === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);

  // Anéis de órbita — uma vez por combinação (parentId, orbitRadius), não
  // uma vez por irmão (todos os irmãos de um shell compartilham o mesmo
  // anel).
  const drawnRings = new Set<string>();
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.orbitLine;
  for (const n of nodes) {
    if (n.parentId == null || !visibleIds.has(n.id)) continue;
    const key = `${n.parentId}:${n.orbitRadius}`;
    if (drawnRings.has(key)) continue;
    drawnRings.add(key);
    const parent = nodesById.get(n.parentId);
    if (!parent) continue;
    const center = worldToScreen(camera, size.w, size.h, parent.x, parent.y);
    const ringRadiusPx = n.orbitRadius * camera.scale;
    if (!circleOnScreen(center.x, center.y, ringRadiusPx + CULL_MARGIN_PX, size.w, size.h)) continue;
    ctx.beginPath();
    ctx.arc(center.x, center.y, ringRadiusPx, 0, 2 * Math.PI);
    ctx.stroke();
  }

  for (const n of nodes) {
    if (!visibleIds.has(n.id) || n.id === previewId) continue;
    const screen = worldToScreen(camera, size.w, size.h, n.x, n.y);
    const radiusPx = bodyRadiusFor(n.bodyKind, n.depth) * camera.scale;
    if (!circleOnScreen(screen.x, screen.y, radiusPx + CULL_MARGIN_PX, size.w, size.h)) continue;
    drawBody(ctx, screen.x, screen.y, radiusPx, n, colors);
    if (camera.scale > LABEL_SCALE_THRESHOLD) {
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.labelHalo;
      ctx.strokeText(n.name, screen.x, screen.y + radiusPx + 2);
      ctx.fillStyle = colors.label;
      ctx.fillText(n.name, screen.x, screen.y + radiusPx + 2);
    }
  }
}

// Limitador de concorrência simples (semáforo) — usado pelo crawl eager pra
// não disparar dezenas/centenas de requisições ao Drive de uma vez só.
function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = (): Promise<() => void> =>
    new Promise((resolve) => {
      const tryAcquire = () => {
        if (active < limit) {
          active += 1;
          resolve(() => {
            active -= 1;
            const next = queue.shift();
            if (next) next();
          });
        } else {
          queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  return { acquire };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `vault.loadFolderChildren` devolve `undefined` (distinto de `[]`, pasta
// genuinamente vazia) quando a busca falhou — tenta de novo com backoff
// antes de desistir. Sem isso, uma única falha transitória (rate limit,
// erro 500 "internal" intermitente) deixava a pasta permanentemente sem
// filhos no mapa, mesmo que uma nova tentativa pudesse ter funcionado.
// Depois de esgotar as tentativas, mantém o mesmo fallback de antes: trata
// como "sem filhos por enquanto" (devolve `[]`), sem abortar o resto do
// crawl.
async function loadFolderChildrenWithRetry(vault: Vault, folderId: string): Promise<DriveNode[]> {
  for (let attempt = 0; ; attempt++) {
    const children = await vault.loadFolderChildren(folderId);
    if (children !== undefined) return children;
    if (attempt >= RETRY_DELAYS_MS.length) return [];
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

// Aplica `fn` a cada item de `items`, no máximo `limit` de cada vez, e só
// devolve depois que TODOS terminarem — ao contrário de disparar `fn` pra
// toda a árvore de uma vez (só limitando quantos rodam por vez, mas não
// quantos ficam "na fila" esperando), isto processa um lote de tamanho
// fixo (`items.length`) e não cresce mais que isso. Usado por
// loadFolderLevel pra processar UM NÍVEL de profundidade por vez.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const semaphore = createSemaphore(limit);
  return Promise.all(
    items.map(async (item) => {
      const release = await semaphore.acquire();
      try {
        return await fn(item);
      } finally {
        release();
      }
    }),
  );
}

// Carrega UM NÍVEL de profundidade (a lista de pastas em `frontier`) e
// devolve o próximo nível (as subpastas descobertas dentro delas) — não
// tem laço nem pausa entre níveis: quem decide QUANDO carregar o próximo é
// o componente, via um botão "Carregar próximo nível" (controle manual
// pedido pelo usuário depois que o avanço automático, mesmo pausado a cada
// meio segundo, continuou derrubando o app em vaults grandes — sinal de que
// a causa mais provável não era o RITMO do carregamento, e sim o TAMANHO de
// um nível específico ou o total acumulado; controle manual deixa o usuário
// avançar na própria dose e observar exatamente em que nível o problema
// aparece). `vault.loadFolderChildren` é cache-aware e não busca conteúdo
// de nota (`fetchNoteContent: false`), então não desperdiça requisições em
// texto que esta visualização nunca usa. Erros de uma pasta individual
// (mesmo após as tentativas de `loadFolderChildrenWithRetry`) não abortam o
// nível inteiro — a pasta problemática só fica sem filhos no mapa. `seen` é
// mutado em nome de quem chama (sobrevive entre cliques) — evita descobrir
// a mesma subpasta duas vezes.
async function loadFolderLevel(vault: Vault, frontier: string[], seen: Set<string>): Promise<string[]> {
  const nextLevelBatches = await mapWithConcurrency(frontier, MAX_CONCURRENT_FOLDER_LOADS, async (folderId) => {
    const children = await loadFolderChildrenWithRetry(vault, folderId);
    const subfolders = children.filter((c) => c.isFolder && !EXCLUDED_NAMES.has(c.name) && !seen.has(c.id));
    for (const sf of subfolders) seen.add(sf.id);
    return subfolders.map((sf) => sf.id);
  });
  return nextLevelBatches.flat();
}

// Visualização "sistema solar" (releitura orbital da mesma hierarquia de
// contenção que a árvore/grafo já mostram) — canvas cru, sem
// react-force-graph-2d (não é uma simulação de física, é um layout
// geométrico procedural, ver grafosSolarSystem.ts). Ao contrário do
// grafo, carrega o vault INTEIRO sozinho ao montar (ver crawlVault acima) em
// vez de esperar cliques de expansão.
export function GrafosSolarSystemView({
  vault,
  onEditNote,
  onNodeDeleted,
}: {
  vault: Vault;
  onEditNote: (fileId: string) => void;
  onNodeDeleted?: (fileId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // Carregamento por nível, controlado manualmente por um botão (ver JSX
  // mais abaixo) — não avança sozinho. `seenRef` acumula todo id de pasta
  // já descoberto (sobrevive entre cliques); `frontierRef` guarda o
  // PRÓXIMO nível a carregar quando o usuário clicar de novo. `levelNumber`
  // é só o contador exibido na tela (0 = ainda só a raiz).
  const seenRef = useRef<Set<string>>(new Set());
  const frontierRef = useRef<string[]>([]);
  const [levelNumber, setLevelNumber] = useState(0);
  const [loadingLevel, setLoadingLevel] = useState(false);
  const [hasMoreLevels, setHasMoreLevels] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [htmlViewerNode, setHtmlViewerNode] = useState<SolarNode | null>(null);
  const [actionNode, setActionNode] = useState<SolarNode | null>(null);
  const [renameTarget, setRenameTarget] = useState<SolarNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<SolarNode | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  // Erro capturado FORA do ciclo de render do React (loop de animação via
  // requestAnimationFrame, ResizeObserver, promises não tratadas) — o
  // GrafosViewErrorBoundary que envolve este componente só pega exceções
  // lançadas DURANTE a renderização; nada disso passa por lá. Sem isso,
  // relatos de "o app fecha" eram indistinguíveis de um crash de verdade,
  // mesmo sendo (possivelmente) só uma exceção JS silenciosa em algum canto
  // assíncrono. Mostrado como um aviso na tela (ver JSX abaixo) em vez de
  // travar tudo — o loop de animação também para de se reagendar quando
  // isto é setado, pra não crashar/logar em rajada a 60fps.
  const [fatalError, setFatalError] = useState<string | null>(null);
  // Colapso/expansão aqui é puramente visual — os dados já vêm todos
  // carregados pelo crawl eager, então não há nada pra "buscar" ao clicar
  // numa pasta; só decide o que fica escondido do desenho/hit-test, sem
  // mexer em `vault.state.expandedIds` (isso continua controlando só a
  // árvore/grafo).
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const colors = useSolarColors();
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const didInitialFitRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const nodesCacheRef = useRef<Map<string, SolarNode>>(new Map());
  // Amostrado, não `vault.state` cru — ver comentário de
  // SOLAR_DATA_THROTTLE_MS acima (evita recalcular a árvore inteira a cada
  // pasta que o crawl carrega).
  const throttledVaultState = useThrottledValue(vault.state, SOLAR_DATA_THROTTLE_MS);
  const solarData = useMemo(
    () => reconcileSolarNodes(buildSolarSystemData(throttledVaultState), nodesCacheRef.current),
    [throttledVaultState],
  );
  const nodesByIdRef = useRef<Map<string, SolarNode>>(new Map());
  useEffect(() => {
    nodesByIdRef.current = new Map(solarData.nodes.map((n) => [n.id, n]));
  }, [solarData]);

  const visibleIds = useMemo(() => {
    const nodesById = nodesByIdRef.current;
    const cache = new Map<string, boolean>();
    function isVisible(id: string): boolean {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const node = nodesById.get(id);
      if (!node) return false;
      const value = node.parentId == null ? true : !collapsedIds.has(node.parentId) && isVisible(node.parentId);
      cache.set(id, value);
      return value;
    }
    const visible = new Set<string>();
    for (const n of solarData.nodes) if (isVisible(n.id)) visible.add(n.id);
    return visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solarData, collapsedIds]);

  const previewNode = previewId ? solarData.nodes.find((n) => n.id === previewId) : undefined;

  // Evita atualizar estado depois que o componente desmontou (troca de modo
  // no meio de um carregamento de nível) — compartilhado entre o efeito de
  // montagem abaixo e o clique manual do botão "Carregar próximo nível".
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Rede de segurança pra exceções que o GrafosViewErrorBoundary (que
  // envolve este componente) NÃO pega — ele só cobre erros lançados durante
  // a renderização; nada em `requestAnimationFrame`, `ResizeObserver` ou
  // promises fica coberto. Escuta em `window` (não dá pra escopar só a este
  // componente) enquanto ele estiver montado, e mostra o erro na tela em
  // vez de deixar um crash "silencioso" indistinguível de um crash de
  // verdade.
  useEffect(() => {
    function onError(e: ErrorEvent) {
      setFatalError(e.message || String(e.error ?? 'erro desconhecido'));
    }
    function onRejection(e: PromiseRejectionEvent) {
      setFatalError(e.reason instanceof Error ? e.reason.message : String(e.reason));
    }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Carrega um nível (lista de ids em `frontier`) e avança o estado de
  // progresso — chamado tanto pelo efeito de montagem (nível 0, a raiz)
  // quanto pelo botão manual "Carregar próximo nível" (ver JSX abaixo).
  const loadNextLevel = useCallback(
    async (frontier: string[]) => {
      if (frontier.length === 0) return;
      setLoadingLevel(true);
      try {
        const next = await loadFolderLevel(vault, frontier, seenRef.current);
        if (!mountedRef.current) return;
        frontierRef.current = next;
        setHasMoreLevels(next.length > 0);
        setLevelNumber((n) => n + 1);
      } catch (e) {
        if (mountedRef.current) setFatalError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mountedRef.current) setLoadingLevel(false);
      }
    },
    [vault],
  );

  // --- Carrega só o nível 0 (a raiz) automaticamente ao montar — os
  // demais níveis são manuais, ver botão "Carregar próximo nível" no JSX.
  useEffect(() => {
    const rootId = vault.state.rootId;
    if (!rootId) return;
    seenRef.current = new Set([rootId]);
    frontierRef.current = [];
    setLevelNumber(0);
    setHasMoreLevels(true);
    void loadNextLevel([rootId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.state.rootId]);

  // --- Redimensionamento do canvas (ResizeObserver + devicePixelRatio) ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
  }, [size]);

  // Ajusta o enquadramento uma única vez, assim que o crawl eager revela o
  // primeiro conteúdo além da raiz — não repete depois (mesmo espírito do
  // `handleEngineStop`/`zoomToFit` do grafo, pra não "puxar o tapete" de
  // onde o usuário estava navegando).
  const fitToView = useCallback(() => {
    const s = sizeRef.current;
    if (s.w === 0 || s.h === 0 || solarData.nodes.length === 0) return;
    let maxAbs = 1;
    for (const n of solarData.nodes) {
      maxAbs = Math.max(maxAbs, Math.abs(n.x), Math.abs(n.y));
    }
    const scale = clamp(Math.min(s.w, s.h) / (2 * maxAbs * 1.2), MIN_SCALE, MAX_SCALE);
    cameraRef.current = { x: 0, y: 0, scale };
  }, [solarData]);

  useEffect(() => {
    if (didInitialFitRef.current || solarData.nodes.length <= 1) return;
    didInitialFitRef.current = true;
    fitToView();
  }, [solarData, fitToView]);

  // --- Loop de animação: um único requestAnimationFrame, mantido vivo
  // entre renders via `tickRef` (a closure é trocada a cada render pra
  // sempre ler dados/cores frescos, mas a corrente de rAF nunca é
  // reiniciada) ---
  const rafRef = useRef<number>();
  const lastTsRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const tickRef = useRef<(now: number) => void>();

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const update = () => {
      reducedMotionRef.current = mq.matches;
    };
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  tickRef.current = (now: number) => {
    // Uma exceção aqui dentro (canvas/API não suportada nesse WebView,
    // dado inesperado no meio da animação, etc.) NÃO é pega pelo
    // GrafosViewErrorBoundary (rAF roda fora do ciclo de render do React)
    // — sem o try/catch, ela vira um crash silencioso: o loop simplesmente
    // para de se reagendar e a tela congela sem nenhuma mensagem. Com o
    // catch, mostra o erro (`fatalError`, ver JSX) e para de tentar de
    // novo — evita também um possível crash-loop reexecutando o mesmo erro
    // a 60fps.
    try {
      const dt = clamp((now - lastTsRef.current) / 1000, 0, 0.1);
      lastTsRef.current = now;
      if (!reducedMotionRef.current) advanceAngles(solarData.nodes, dt);
      computeWorldPositions(solarData.nodes, nodesByIdRef.current);
      draw(canvasRef.current, solarData.nodes, nodesByIdRef.current, visibleIds, cameraRef.current, sizeRef.current, colors, previewId);
      const card = cardRef.current;
      if (previewNode && card) {
        const screen = worldToScreen(cameraRef.current, sizeRef.current.w, sizeRef.current.h, previewNode.x, previewNode.y);
        const width = CARD_BASE_WIDTH * cameraRef.current.scale;
        card.style.left = `${screen.x - width / 2}px`;
        card.style.top = `${screen.y}px`;
        card.style.width = `${width}px`;
        card.style.height = previewNode.dataKind === 'note' ? `${width * A4_RATIO}px` : '';
        card.style.fontSize = `${CARD_BASE_FONT_SIZE * cameraRef.current.scale}px`;
      }
    } catch (e) {
      setFatalError(e instanceof Error ? e.message : String(e));
      return;
    }
    rafRef.current = requestAnimationFrame((t) => tickRef.current?.(t));
  };

  useEffect(() => {
    lastTsRef.current = performance.now();
    rafRef.current = requestAnimationFrame((t) => tickRef.current?.(t));
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      } else if (rafRef.current == null) {
        lastTsRef.current = performance.now();
        rafRef.current = requestAnimationFrame((t) => tickRef.current?.(t));
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // --- Câmera: pan/zoom/hit-test/long-press, tudo implementado na mão
  // (affine 2D simples, ver worldToScreen/screenToWorld acima) ---
  const canOpenActionMenu = useCallback((n: SolarNode) => n.id !== vault.state.rootId, [vault.state.rootId]);

  const toggleCollapse = useCallback((folderId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const onNodeTap = useCallback(
    (node: SolarNode) => {
      const camera = cameraRef.current;
      camera.x = -node.x * camera.scale;
      camera.y = -node.y * camera.scale;
      if (node.dataKind === 'folder') {
        if (node.id === vault.state.rootId) return;
        toggleCollapse(node.id);
        return;
      }
      if (node.dataKind === 'note') {
        setPreviewId(node.id);
        void vault.openNote(node.id, { name: node.name });
        return;
      }
      if (node.dataKind === 'file') {
        const fileKind = driveIconKind({ name: node.name, mimeType: node.mimeType ?? '' });
        if (fileKind === 'image' || fileKind === 'pdf') {
          setPreviewId(node.id);
        } else if (fileKind === 'html') {
          setHtmlViewerNode(node);
        }
      }
    },
    [vault, toggleCollapse],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function applyZoom(screenX: number, screenY: number, factor: number) {
      const s = sizeRef.current;
      const camera = cameraRef.current;
      const before = screenToWorld(camera, s.w, s.h, screenX, screenY);
      camera.scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
      const after = worldToScreen(camera, s.w, s.h, before.x, before.y);
      camera.x += screenX - after.x;
      camera.y += screenY - after.y;
    }

    function findPreviewNodeAt(clientX: number, clientY: number): SolarNode | undefined {
      const card = cardRef.current;
      if (!previewId || !card) return undefined;
      const r = card.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return undefined;
      return solarData.nodes.find((n) => n.id === previewId);
    }

    function findNodeAt(clientX: number, clientY: number): SolarNode | undefined {
      const rect = el!.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const camera = cameraRef.current;
      const s = sizeRef.current;
      let closest: SolarNode | undefined;
      let closestDist = Infinity;
      for (const n of solarData.nodes) {
        if (!visibleIds.has(n.id)) continue;
        const screen = worldToScreen(camera, s.w, s.h, n.x, n.y);
        const dist = Math.hypot(screen.x - x, screen.y - y);
        const radiusPx = bodyRadiusFor(n.bodyKind, n.depth) * camera.scale;
        const tolerance = Math.max(radiusPx, 18);
        if (dist <= tolerance && dist < closestDist) {
          closest = n;
          closestDist = dist;
        }
      }
      return closest;
    }

    const pointers = new Map<number, { x: number; y: number }>();
    let dragLast: { x: number; y: number } | null = null;
    let pinchLastDist: number | null = null;
    let longPressTimer: number | null = null;
    let longPressStart: { x: number; y: number } | null = null;
    let suppressClick = false;

    function clearLongPress() {
      if (longPressTimer != null) window.clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressStart = null;
    }

    function onPointerDown(e: PointerEvent) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragLast = { x: e.clientX, y: e.clientY };
        longPressStart = { x: e.clientX, y: e.clientY };
        suppressClick = false;
        if (e.pointerType !== 'mouse') {
          longPressTimer = window.setTimeout(() => {
            longPressTimer = null;
            const pos = longPressStart;
            longPressStart = null;
            if (!pos) return;
            const node = findNodeAt(pos.x, pos.y);
            if (node && canOpenActionMenu(node)) {
              suppressClick = true;
              setActionNode(node);
            }
          }, LONG_PRESS_MS);
        }
      } else if (pointers.size === 2) {
        clearLongPress();
        const pts = Array.from(pointers.values());
        pinchLastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (pinchLastDist != null && pinchLastDist > 0) {
          applyZoom(mid.x, mid.y, dist / pinchLastDist);
        }
        pinchLastDist = dist;
        return;
      }

      if (longPressStart) {
        const dx = e.clientX - longPressStart.x;
        const dy = e.clientY - longPressStart.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
          clearLongPress();
          suppressClick = true;
        }
      }

      if (dragLast && pointers.size === 1) {
        const dx = e.clientX - dragLast.x;
        const dy = e.clientY - dragLast.y;
        cameraRef.current.x += dx;
        cameraRef.current.y += dy;
        dragLast = { x: e.clientX, y: e.clientY };
      }
    }

    function onPointerUp(e: PointerEvent) {
      const wasSize = pointers.size;
      pointers.delete(e.pointerId);
      clearLongPress();

      if (wasSize === 1 && !suppressClick) {
        const previewHit = findPreviewNodeAt(e.clientX, e.clientY);
        if (previewHit) {
          setPreviewId(null);
        } else {
          const node = findNodeAt(e.clientX, e.clientY);
          if (node) onNodeTap(node);
        }
      }
      dragLast = null;
      pinchLastDist = null;
      suppressClick = false;
    }

    function onPointerCancel(e: PointerEvent) {
      pointers.delete(e.pointerId);
      clearLongPress();
      dragLast = null;
      pinchLastDist = null;
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      applyZoom(e.clientX - rect.left, e.clientY - rect.top, Math.pow(1.0015, -e.deltaY));
    }

    function onContextMenu(e: MouseEvent) {
      const node = findNodeAt(e.clientX, e.clientY);
      if (node && canOpenActionMenu(node)) {
        e.preventDefault();
        setActionNode(node);
      }
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
      clearLongPress();
    };
  }, [solarData, visibleIds, previewId, canOpenActionMenu, onNodeTap]);

  // --- Renomear/mover/excluir/editar — mesma lógica de GrafosGraphView.tsx,
  // simplificada porque SolarNode já carrega `parentId` diretamente (não
  // precisa escanear `state.folders`/`state.notes` pra descobrir a pasta-mãe). ---
  const handleRenameNode = useCallback(
    async (node: SolarNode, newDisplayName: string) => {
      setRenameTarget(null);
      try {
        if (node.dataKind === 'note') {
          const finalName = buildRenamedFileName(node.name, newDisplayName);
          if (finalName === node.name) return;
          await vault.renameNote(node.id, node.name, finalName);
        } else {
          if (newDisplayName === node.name) return;
          await vault.renameFolderOrFile(node.id, newDisplayName);
        }
      } catch (e) {
        setActionStatus(`Erro ao renomear: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vault],
  );

  const handleMoveNode = useCallback(
    async (node: SolarNode, destFolderId: string) => {
      setMoveTarget(null);
      const oldParentId = node.parentId;
      if (!oldParentId || oldParentId === destFolderId) return;
      try {
        await vault.moveNode(node.id, oldParentId, destFolderId);
      } catch (e) {
        setActionStatus(`Erro ao mover: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vault],
  );

  const handleDeleteNode = useCallback(
    async (node: SolarNode) => {
      setActionNode(null);
      if (!window.confirm(`Excluir "${node.name}"? O item vai para a lixeira do Google Drive.`)) return;
      try {
        await vault.deleteFile(node.id);
        if (node.id === previewId) setPreviewId(null);
        onNodeDeleted?.(node.id);
      } catch (e) {
        setActionStatus(`Erro ao excluir: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vault, previewId, onNodeDeleted],
  );

  const handleEditNode = useCallback(
    (node: SolarNode) => {
      setActionNode(null);
      onEditNote(node.id);
    },
    [onEditNote],
  );

  return (
    <div className="grafos-solar-view" ref={containerRef}>
      <canvas ref={canvasRef} />

      {fatalError && (
        <div className="grafos-solar-fatal-error">
          <p className="error">Erro inesperado no sistema solar: {fatalError}</p>
          <button type="button" className="btn-secondary" onClick={() => setFatalError(null)}>
            Fechar aviso
          </button>
        </div>
      )}

      {!fatalError && (
        <div className="grafos-solar-crawl-controls grafos-status-line">
          <span className="muted">
            Nível {levelNumber} carregado · {solarData.nodes.length} corpos no mapa
          </span>
          {hasMoreLevels ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={loadingLevel || frontierRef.current.length === 0}
              onClick={() => void loadNextLevel(frontierRef.current)}
            >
              {loadingLevel
                ? 'Carregando…'
                : `Carregar nível ${levelNumber + 1} (${frontierRef.current.length} pasta${
                    frontierRef.current.length === 1 ? '' : 's'
                  })`}
            </button>
          ) : (
            <span className="muted">Universo completo.</span>
          )}
        </div>
      )}

      <div className="grafos-graph-controls">
        <button
          type="button"
          onClick={() => {
            const s = sizeRef.current;
            const camera = cameraRef.current;
            const before = screenToWorld(camera, s.w, s.h, s.w / 2, s.h / 2);
            camera.scale = clamp(camera.scale * ZOOM_BUTTON_FACTOR, MIN_SCALE, MAX_SCALE);
            const after = worldToScreen(camera, s.w, s.h, before.x, before.y);
            camera.x += s.w / 2 - after.x;
            camera.y += s.h / 2 - after.y;
          }}
          aria-label="Aumentar zoom"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            const s = sizeRef.current;
            const camera = cameraRef.current;
            const before = screenToWorld(camera, s.w, s.h, s.w / 2, s.h / 2);
            camera.scale = clamp(camera.scale / ZOOM_BUTTON_FACTOR, MIN_SCALE, MAX_SCALE);
            const after = worldToScreen(camera, s.w, s.h, before.x, before.y);
            camera.x += s.w / 2 - after.x;
            camera.y += s.h / 2 - after.y;
          }}
          aria-label="Diminuir zoom"
        >
          −
        </button>
        <button type="button" onClick={fitToView}>
          Ajustar
        </button>
      </div>

      {previewId && previewNode && (
        previewNode.dataKind === 'note' ? (
          <GrafosNoteGraphCard ref={cardRef} note={vault.state.notes.get(previewId)} />
        ) : (
          <GrafosFilePreviewCard
            ref={cardRef}
            fileId={previewId}
            mimeType={previewNode.mimeType ?? ''}
            readFileBytes={vault.readFilePreview}
          />
        )
      )}

      {actionNode && (
        <>
          <div className="grafos-conflict-backdrop" aria-hidden="true" onClick={() => setActionNode(null)} />
          <div className="grafos-node-menu" role="menu" aria-label={`Ações para ${actionNode.name}`}>
            <p className="grafos-node-menu-title">{actionNode.name}</p>
            {actionNode.dataKind === 'note' && (
              <button type="button" onClick={() => handleEditNode(actionNode)}>
                Editar
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRenameTarget(actionNode);
                setActionNode(null);
              }}
            >
              Renomear
            </button>
            <button
              type="button"
              onClick={() => {
                setMoveTarget(actionNode);
                setActionNode(null);
              }}
            >
              Mover para pasta…
            </button>
            {actionNode.dataKind !== 'folder' && (
              <button type="button" className="danger" onClick={() => void handleDeleteNode(actionNode)}>
                Excluir
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setActionNode(null)}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {renameTarget && (
        <GrafosRenameDialog
          title={`Renomear "${renameTarget.name}"`}
          initialValue={renameTarget.dataKind === 'note' ? stripMdExtension(renameTarget.name) : renameTarget.name}
          onCancel={() => setRenameTarget(null)}
          onSave={(newValue) => void handleRenameNode(renameTarget, newValue)}
        />
      )}

      {moveTarget && (
        <GrafosMoveDialog
          vault={vault}
          itemName={moveTarget.name}
          excludeFolderId={moveTarget.id}
          onCancel={() => setMoveTarget(null)}
          onMoveTo={(destFolderId) => void handleMoveNode(moveTarget, destFolderId)}
        />
      )}

      {actionStatus && <p className="error grafos-status-line grafos-graph-warning">{actionStatus}</p>}

      {htmlViewerNode && (
        <GrafosHtmlViewerDialog
          fileId={htmlViewerNode.id}
          fileName={htmlViewerNode.name}
          readFileBytes={vault.readFilePreview}
          onClose={() => setHtmlViewerNode(null)}
        />
      )}
    </div>
  );
}
