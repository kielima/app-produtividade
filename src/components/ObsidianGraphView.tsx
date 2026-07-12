import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import {
  buildGraphData,
  reconcileGraphNodes,
  type GraphLink,
  type GraphNode,
  type GraphNodeKind,
} from '../lib/obsidianGraph';
import { filterExactNameMatches } from '../lib/obsidianBacklinks';
import { driveIconKind } from '../lib/driveFileIcons';
import { buildRenamedFileName, stripMdExtension } from '../lib/obsidianWikilink';
import type { useObsidianVault } from '../lib/obsidianTree';
import { findParentFolderId } from '../lib/obsidianTreeState';
import { ObsidianNoteGraphCard } from './ObsidianNoteGraphCard';
import { ObsidianFilePreviewCard } from './ObsidianFilePreviewCard';
import { ObsidianRenameDialog } from './ObsidianRenameDialog';
import { ObsidianMoveDialog } from './ObsidianMoveDialog';

// Tamanho-base do cartão de preview em "unidades de mundo" do grafo (mesma
// unidade de `x`/`y` dos nós e da distância configurada em
// `d3Force('link').distance(...)`) — multiplicado pelo zoom atual
// (`globalScale`) a cada frame pra virar pixels de tela, fazendo o cartão
// crescer/encolher junto com o resto do grafo. Usuário testou a versão
// anterior (largura 110) e reportou que ainda ficava grande demais —
// reduzido em 75% (110→27.5, 5→1.25). Ponto de partida ainda não validado
// com o grafo real (sandbox sem sessão do Drive) — ajustar se precisar.
const CARD_BASE_WIDTH = 27.5;
const CARD_BASE_FONT_SIZE = 1.25;
// Proporção de página A4 (297/210mm) — vira `min-height` do cartão (não
// `height`): uma nota curta fica com cara de página de verdade; uma nota
// longa ainda cresce além disso e é lida arrastando o grafo, sem cortar.
const A4_RATIO = 297 / 210;

// Segurar em cima de um nó deveria disparar o `contextmenu` nativo do
// navegador (usado por `onNodeRightClick` mais abaixo) — funciona no desktop
// (clique direito) mas o usuário confirmou que NÃO dispara de forma
// confiável no WebView do Android dentro do app instalado, provavelmente
// porque `touch-action: none` (necessário pro pan/zoom do d3-zoom) e o
// d3-drag (arrastar nó) competem pela mesma detecção nativa de "toque
// parado". Por isso o long-press também é detectado manualmente (ver efeito
// mais abaixo): um temporizador no pointerdown, cancelado se o dedo se mover
// mais que a tolerância ou soltar antes do tempo — mesma lógica que o
// Android usa nativamente, só que em JS.
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

const BASE_CHARGE_STRENGTH = -160;
// O nó em preview vira um cartão maior que um círculo — sem uma repulsão
// própria mais forte, os nós vizinhos (que só conhecem a distância "normal"
// entre círculos) acabam desenhados por baixo do cartão. Multiplicador
// reduzido junto com o tamanho do cartão acima (era 12x pro cartão maior).
const PREVIEW_CHARGE_STRENGTH = BASE_CHARGE_STRENGTH * 4;
const LINK_DISTANCE = 70;

type Vault = ReturnType<typeof useObsidianVault>;
type GNode = NodeObject<GraphNode>;
type GLink = LinkObject<GraphNode, GraphLink>;

// Canvas 2D não lê variáveis CSS (`var(--x)`) diretamente — resolvidas uma
// vez via getComputedStyle e recalculadas quando o tema claro/escuro muda.
type GraphColors = {
  folder: string;
  note: string;
  file: string;
  ghost: string;
  label: string;
  labelHalo: string;
  containment: string;
  summary: string;
};

function resolveGraphColors(): GraphColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    folder: read('--accent', '#e07b00'),
    note: read('--graph-note', '#3468d1'),
    file: read('--muted', '#888'),
    ghost: read('--border', '#bbb'),
    label: read('--fg', '#1a1a1a'),
    // Contorno do rótulo na cor de fundo — texto legível mesmo quando cai em
    // cima de um nó/linha vizinho, sem precisar espaçar tudo perfeitamente.
    labelHalo: read('--bg', '#fafafa'),
    containment: read('--border', '#ccc'),
    summary: read('--muted', '#888'),
  };
}

function useGraphColors(): GraphColors {
  const [colors, setColors] = useState(resolveGraphColors);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setColors(resolveGraphColors());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return colors;
}

// Visualização de grafo unificado (spec item 4) — mesma fonte de dados da
// árvore (`vault`), só uma forma diferente de olhar pra ela. Expandir uma
// pasta aqui chama exatamente `vault.expandFolder`, igual à árvore.
export function ObsidianGraphView({
  vault,
  onEditNote,
  onNodeDeleted,
}: {
  vault: Vault;
  onEditNote: (fileId: string) => void;
  // Chamado depois de excluir com sucesso — a árvore (ObsidianView.tsx) usa
  // isto pra limpar `selectedNoteId` se o item excluído era a nota aberta no
  // editor (o editor não fica visível ao mesmo tempo que o grafo, mas a
  // seleção sobrevive à troca de modo).
  onNodeDeleted?: (fileId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [ghostWarning, setGhostWarning] = useState<string | null>(null);
  const [actionNode, setActionNode] = useState<GraphNode | null>(null);
  const [renameTarget, setRenameTarget] = useState<GraphNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<GraphNode | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const colors = useGraphColors();
  const didInitialFitRef = useRef(false);

  // Posição (mundo) do nó em preview, atualizada a cada frame dentro de
  // `nodeCanvasObject` — lida logo em seguida por `syncPreviewOverlay`
  // (mesmo frame) pra posicionar o cartão HTML. Fica numa ref (não state)
  // porque muda a ~60fps durante pan/zoom; um `setState` nessa frequência
  // re-renderizaria a árvore React inteira sem necessidade.
  const previewNodePosRef = useRef<{ x: number; y: number; kind: GraphNodeKind } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Posição fixada manualmente, por id — só entra aqui quando o usuário
  // escolhe "Fixar posição" no menu de contexto do grafo (nunca automático:
  // a versão anterior fixava toda pasta sozinha e o usuário reportou que
  // ficava ruim, tudo parecia "recarregar" e reacomodar sem controle).
  // Diferente de `nodeObjectsRef` abaixo (que só sobrevive enquanto o nó
  // continua aparecendo no grafo): esta ref sobrevive mesmo que o nó suma
  // temporariamente (pasta pai recolhida) e reapareça bem depois — reaplicada
  // no efeito mais abaixo sempre que `graphData` é recalculado.
  const pinnedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // `buildGraphData` monta objetos de nó NOVOS a cada chamada (Map fresco,
  // literais `{id,name,kind,mimeType}` sem x/y) — e o d3-force por baixo do
  // react-force-graph-2d NÃO reconcilia por id: ele só preserva x/y de um nó
  // se for literalmente o MESMO objeto JS de antes, e reaquece a simulação
  // (alpha=1) toda vez que `graphData` muda. Sem isso, qualquer mudança de
  // `vault.state` — renomear, expandir/colapsar pasta, abrir/fechar preview —
  // fazia TODO nó sem posição reaparecer na espiral de posição inicial do
  // d3-force e a simulação reaquecer do zero, exatamente o "fica tudo
  // bugado" relatado. Este cache reaproveita o MESMO objeto (com x/y/vx/vy/
  // fx/fy que a física já vinha ajustando) pra todo nó que continua visível
  // entre uma recomputação e outra, só atualizando os campos "de dados"
  // nele; só ganha posição nova (a tal espiral) quem é genuinamente novo no
  // grafo. Ids que somem (pasta recolhida, item excluído) são descartados do
  // cache — se reaparecerem depois, a posição é perdida aqui mas
  // `pinnedPositionsRef` acima ainda lembra se o usuário tinha fixado.
  const nodeObjectsRef = useRef<Map<string, GraphNode>>(new Map());

  useEffect(() => {
    if (!previewId) previewNodePosRef.current = null;
  }, [previewId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(
    () => reconcileGraphNodes(buildGraphData(vault.state), nodeObjectsRef.current),
    [vault.state],
  );
  // Kind/mimeType do nó em preview (pra decidir qual cartão renderizar) —
  // dado estático, já disponível em `graphData` sem precisar esperar o
  // próximo frame do canvas (diferente de `previewNodePosRef`, que só tem
  // x/y, que SIM muda a cada frame durante a simulação/pan/zoom).
  const previewNode = previewId ? graphData.nodes.find((n) => n.id === previewId) : undefined;

  // Fantasma (não é item real do Drive) e a raiz do vault (não tem pai pra
  // renomear/mover/excluir/fixar) nunca abrem o menu de contexto — guarda
  // compartilhada pelo clique-direito nativo (desktop) e pelo long-press
  // manual (touch) abaixo.
  const canOpenActionMenu = useCallback(
    (n: GraphNode) => n.kind !== 'ghost' && !(n.kind === 'folder' && n.id === vault.state.rootId),
    [vault.state.rootId],
  );

  // Detecção manual de long-press E de toque simples (touch) — ver
  // comentário de LONG_PRESS_MS/LONG_PRESS_MOVE_TOLERANCE_PX no topo do
  // arquivo sobre por que não dá pra confiar só no `contextmenu` nativo
  // aqui. Escuta no CONTÊINER (não no canvas do force-graph) via bubbling —
  // nunca chama preventDefault/stopPropagation, então o pan/zoom/drag do
  // d3-zoom continuam recebendo o mesmo toque normalmente; um pan de
  // verdade ultrapassa a tolerância de movimento e cancela o temporizador
  // antes de disparar, evitando abrir o menu no meio de um gesto de
  // arrastar o grafo.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timer: number | null = null;
    let start: { x: number; y: number } | null = null;

    const clear = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
      start = null;
    };

    // O nó em preview vira um cartão grande (não mais um círculo pequeno) —
    // achá-lo pela posição real do elemento renderizado (`cardRef`, já
    // dimensionado pelo browser, funciona igual pra nota com altura A4 fixa
    // e pra imagem/PDF com altura natural) é mais simples e mais preciso do
    // que recalcular a área do cartão aqui. Usado tanto pro long-press
    // (segurar em cima do cartão também abre o menu de ações) quanto pro
    // toque simples que fecha o preview.
    const findPreviewNodeAt = (clientX: number, clientY: number): GraphNode | undefined => {
      const card = cardRef.current;
      if (!previewId || !card) return undefined;
      const r = card.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return undefined;
      return graphData.nodes.find((n) => n.id === previewId);
    };

    const findNodeAt = (clientX: number, clientY: number): GraphNode | undefined => {
      const previewNodeHit = findPreviewNodeAt(clientX, clientY);
      if (previewNodeHit) return previewNodeHit;
      const g = graphRef.current;
      if (!g) return undefined;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const zoom = g.zoom() || 1;
      let closest: GraphNode | undefined;
      let closestDist = Infinity;
      for (const node of graphData.nodes) {
        const n = node as GraphNode & { x?: number; y?: number };
        if (n.x == null || n.y == null) continue;
        const screen = g.graph2ScreenCoords(n.x, n.y);
        const dist = Math.hypot(screen.x - x, screen.y - y);
        // Raio de desenho (ver nodeCanvasObject) convertido pra pixels de
        // tela, com um piso de toque generoso — mesmo espírito do raio maior
        // já usado pro toque no celular.
        const radiusPx = (n.kind === 'folder' ? 5 : 3.5) * zoom;
        const tolerance = Math.max(radiusPx, 18);
        if (dist <= tolerance && dist < closestDist) {
          closest = n;
          closestDist = dist;
        }
      }
      return closest;
    };

    const onPointerDown = (e: PointerEvent) => {
      clear();
      start = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse') return; // desktop já usa onNodeRightClick (clique direito nativo) pro menu
      timer = window.setTimeout(() => {
        const pos = start;
        timer = null;
        start = null;
        if (!pos) return;
        const node = findNodeAt(pos.x, pos.y);
        if (node && canOpenActionMenu(node)) setActionNode(node);
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX) clear();
    };

    // Toque simples (soltou antes do long-press disparar e sem mover muito
    // — `start` só continua não-nulo nesse caso, ver `clear()`) em cima do
    // cartão de preview fecha o preview — substitui o botão "×" antigo.
    // Não distingue mouse/touch aqui (diferente do long-press acima): sem o
    // botão "×", o clique também precisa continuar funcionando no desktop.
    const onPointerUp = () => {
      const tapPos = start;
      clear();
      if (tapPos && findPreviewNodeAt(tapPos.x, tapPos.y)) setPreviewId(null);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', clear);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', clear);
      clear();
    };
  }, [graphData, canOpenActionMenu, previewId]);

  // Repulsão/distância padrão do force-graph deixa os círculos praticamente
  // encostados um no outro (difícil de tocar o certo no celular) — aumenta o
  // espaçamento pra cada nó ficar mais isolado e legível. O nó em preview
  // (se houver) recebe repulsão bem mais forte — o cartão dele é bem maior
  // que um círculo, então precisa empurrar os vizinhos pra mais longe pra
  // não ficarem desenhados por baixo dele.
  useEffect(() => {
    graphRef.current?.d3Force('charge')?.strength((node: { id?: string }) =>
      node.id === previewId ? PREVIEW_CHARGE_STRENGTH : BASE_CHARGE_STRENGTH,
    );
    graphRef.current?.d3Force('link')?.distance(LINK_DISTANCE);
  }, [graphData, previewId]);

  // Só quando o preview abre/fecha (não a cada mudança de `graphData`, que já
  // tem seu próprio reaquecimento): reaquece a simulação pra ela reagir à
  // repulsão nova imediatamente, em vez de só na próxima mexida no grafo.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    graphRef.current?.d3ReheatSimulation();
  }, [previewId]);

  // Só na primeira vez que a simulação estabiliza: enquadra tudo na tela, pra
  // não abrir numa parte aleatória do grafo. Não repete depois disso (ex.:
  // ao expandir uma pasta) pra não "puxar o tapete" de onde o usuário estava
  // navegando — pra isso o botão "Ajustar" já existe.
  const handleEngineStop = useCallback(() => {
    if (didInitialFitRef.current) return;
    didInitialFitRef.current = true;
    graphRef.current?.zoomToFit(400, 60);
  }, []);

  // Reaplica (e mantém fixada) a posição de todo nó que o usuário fixou
  // manualmente, sempre que `graphData` é recalculado. Redundante enquanto o
  // nó continua visível (o cache de `nodeObjectsRef` já preserva fx/fy nele
  // automaticamente), mas necessário pro caso em que o nó sumiu e reapareceu
  // (pasta pai recolhida e expandida de novo) — aí o cache de objeto se
  // perdeu e só `pinnedPositionsRef` ainda lembra a posição fixada. `fx`/`fy`
  // (não só `x`/`y`) tira o nó da física: só volta a se mover se o usuário
  // soltar (handleTogglePin).
  useEffect(() => {
    for (const node of graphData.nodes) {
      const n = node as GraphNode & { x?: number; y?: number; fx?: number; fy?: number };
      const known = pinnedPositionsRef.current.get(n.id);
      if (!known) continue;
      n.x = known.x;
      n.y = known.y;
      n.fx = known.x;
      n.fy = known.y;
    }
  }, [graphData]);

  const handleNodeClick = useCallback(
    (node: GNode) => {
      const n = node as GraphNode & { x?: number; y?: number };
      // Centraliza o que foi tocado — pasta, nota ou arquivo — pra ficar
      // fácil de reencontrar mesmo com o resto do grafo se reajustando ao
      // redor (spec do usuário: "centraliza... com o que tem em volta se
      // reajustando"). Só pan, sem mudar o zoom.
      if (n.x != null && n.y != null) graphRef.current?.centerAt(n.x, n.y, 400);
      if (n.kind === 'folder') {
        if (n.id === vault.state.rootId) return;
        if (vault.state.expandedIds.has(n.id)) vault.collapseFolder(n.id);
        else void vault.expandFolder(n.id);
        return;
      }
      if (n.kind === 'note') {
        setGhostWarning(null);
        setPreviewId(n.id);
        void vault.openNote(n.id, { name: n.name });
        return;
      }
      if (n.kind === 'file') {
        // Só imagem/PDF têm preview inline — outros tipos de arquivo (ex.
        // planilha, .docx) continuam sem ação, mesmo padrão da árvore.
        const fileKind = driveIconKind({ name: n.name, mimeType: n.mimeType ?? '' });
        if (fileKind === 'image' || fileKind === 'pdf') {
          setGhostWarning(null);
          setPreviewId(n.id);
        }
        return;
      }
      if (n.kind === 'ghost') {
        setPreviewId(null);
        void (async () => {
          const results = await vault.searchNotes(n.name);
          const exact = filterExactNameMatches(results, n.name);
          if (exact.length === 1) {
            await vault.openNote(exact[0].id, { name: exact[0].name });
            setGhostWarning(null);
          } else {
            setGhostWarning(
              exact.length === 0
                ? `Nenhuma nota chamada "${n.name}" foi encontrada no Drive.`
                : `Mais de uma nota chamada "${n.name}" foi encontrada no Drive — abra manualmente pela árvore.`,
            );
          }
        })();
      }
    },
    [vault],
  );

  // Clique direito (desktop) — no touch, quem abre o menu é o long-press
  // manual detectado no efeito acima (ver comentário lá sobre por que o
  // `contextmenu` nativo não é confiável no WebView do Android). Mantido
  // como reforço: onde o `contextmenu` nativo funcionar (desktop sempre;
  // eventuais Android/navegadores que sintetizem certo), continua útil.
  const handleNodeRightClick = useCallback(
    (node: GNode, event: MouseEvent) => {
      const n = node as GraphNode;
      if (!canOpenActionMenu(n)) return;
      event.preventDefault?.();
      setActionNode(n);
    },
    [canOpenActionMenu],
  );

  // Notas mantêm o comportamento já existente de `renameNote` (corrige
  // wikilinks que citam o nome antigo em qualquer lugar do Drive); pasta/
  // arquivo usam o rename genérico (sem link a corrigir).
  const handleRenameNode = useCallback(
    async (node: GraphNode, newDisplayName: string) => {
      setRenameTarget(null);
      try {
        if (node.kind === 'note') {
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
    async (node: GraphNode, destFolderId: string) => {
      setMoveTarget(null);
      const oldParentId =
        vault.state.notes.get(node.id)?.parentFolderId ?? findParentFolderId(vault.state.folders, node.id);
      if (!oldParentId || oldParentId === destFolderId) return;
      try {
        await vault.moveNode(node.id, oldParentId, destFolderId);
      } catch (e) {
        setActionStatus(`Erro ao mover: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vault],
  );

  // Só oferecido pra nota/arquivo (nunca pasta, ver menu abaixo) — evita
  // apagar uma subárvore inteira sem querer a partir de um toque no grafo.
  const handleDeleteNode = useCallback(
    async (node: GraphNode) => {
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

  // "Editar" morava numa barra de botões flutuante presa ao cartão de
  // preview — agora mora no menu de contexto (segurar em cima do nó), junto
  // de Renomear/Mover/Fixar/Excluir. Funciona pra qualquer nota, não só a
  // que estiver em preview no momento.
  const handleEditNode = useCallback(
    (node: GraphNode) => {
      setActionNode(null);
      onEditNote(node.id);
    },
    [onEditNote],
  );

  // Fixar/soltar posição manualmente (menu de contexto do grafo) — único
  // jeito de um nó ganhar `fx`/`fy` agora; nada é fixado sozinho. Soltar
  // reaquece a simulação pra o nó voltar a reagir à física imediatamente,
  // em vez de só na próxima mudança do vault.
  const handleTogglePin = useCallback(
    (node: GraphNode) => {
      setActionNode(null);
      const live = graphData.nodes.find((n) => n.id === node.id) as
        | (GraphNode & { x?: number; y?: number; fx?: number; fy?: number })
        | undefined;
      if (!live) return;
      if (pinnedPositionsRef.current.has(node.id)) {
        pinnedPositionsRef.current.delete(node.id);
        live.fx = undefined;
        live.fy = undefined;
        graphRef.current?.d3ReheatSimulation();
      } else if (live.x != null && live.y != null) {
        pinnedPositionsRef.current.set(node.id, { x: live.x, y: live.y });
        live.fx = live.x;
        live.fy = live.y;
      }
    },
    [graphData],
  );

  const nodeCanvasObject = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode & { x?: number; y?: number };
      if (n.x == null || n.y == null) return;
      // Nota em preview: em vez do círculo, guarda a posição pro cartão HTML
      // (`ObsidianNoteGraphCard`) ser posicionado em cima dela logo em
      // seguida, em `syncPreviewOverlay` — o cartão ocupa o lugar do nó.
      if (n.id === previewId) {
        previewNodePosRef.current = { x: n.x, y: n.y, kind: n.kind };
        return;
      }
      // Círculos menores que antes — com o espaçamento maior entre nós
      // (d3Force abaixo), reduzem a sobreposição que dificultava tocar no nó
      // certo no celular.
      const radius = n.kind === 'folder' ? 5 : 3.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
      ctx.globalAlpha = n.kind === 'ghost' ? 0.5 : 1;
      ctx.fillStyle = colors[n.kind];
      ctx.fill();
      ctx.globalAlpha = 1;
      // Anel extra pro nó que o usuário fixou manualmente — único jeito de
      // saber isso sem abrir o menu de contexto de novo (ver handleTogglePin).
      if (pinnedPositionsRef.current.has(n.id)) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 2.5 / globalScale, 0, 2 * Math.PI);
        ctx.lineWidth = 1.2 / globalScale;
        ctx.strokeStyle = colors.label;
        ctx.stroke();
      }
      if (globalScale > 0.9) {
        ctx.font = `${13 / globalScale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        // Contorno na cor de fundo antes do preenchimento — legível mesmo
        // sobre outro nó/linha, sem depender de nunca haver sobreposição.
        ctx.lineWidth = 3 / globalScale;
        ctx.strokeStyle = colors.labelHalo;
        ctx.strokeText(n.name, n.x, n.y + radius + 2);
        ctx.fillStyle = colors.label;
        ctx.fillText(n.name, n.x, n.y + radius + 2);
      }
    },
    [colors, previewId],
  );

  // Sincroniza a posição/escala do cartão de preview com o zoom/pan atuais —
  // roda a cada frame, DEPOIS de `nodeCanvasObject` já ter guardado a
  // posição do nó (mesmo frame). Escreve direto no `style` via ref, sem
  // `setState`, pra não re-renderizar React a cada frame (~60fps durante um
  // gesto de pan/zoom).
  const syncPreviewOverlay = useCallback((_ctx: CanvasRenderingContext2D, globalScale: number) => {
    const pos = previewNodePosRef.current;
    const g = graphRef.current;
    if (!pos || !g) return;
    const screen = g.graph2ScreenCoords(pos.x, pos.y);
    const width = CARD_BASE_WIDTH * globalScale;
    const fontSize = CARD_BASE_FONT_SIZE * globalScale;
    const card = cardRef.current;
    if (card) {
      card.style.left = `${screen.x - width / 2}px`;
      card.style.top = `${screen.y}px`;
      card.style.width = `${width}px`;
      // Proporção A4 só faz sentido pra texto sem forma própria (nota
      // Markdown) — imagem/PDF já têm sua própria proporção natural, forçar
      // A4 neles ia distorcer/preencher com espaço em branco à toa. Altura
      // FIXA (não `minHeight`) — nota curta preenche com espaço em branco,
      // nota longa tem o excesso cortado (`overflow: hidden` no CSS) em vez
      // de esticar o cartão num retângulo comprido; "Editar" abre a nota
      // inteira pra ler/editar o resto.
      card.style.height = pos.kind === 'note' ? `${width * A4_RATIO}px` : '';
      card.style.fontSize = `${fontSize}px`;
    }
  }, []);

  const linkColor = useCallback(
    (link: GLink) => {
      const kind = (link as GraphLink).kind;
      return kind === 'containment' ? colors.containment : kind === 'summary' ? colors.summary : colors.note;
    },
    [colors],
  );

  return (
    <div className="obsidian-graph-view" ref={containerRef}>
      {/* Sempre montado (mesmo com o preview de nota por cima) — desmontar
          perderia a posição/zoom do grafo e reiniciaria a simulação física
          toda vez que o usuário fechasse um preview. */}
      <ForceGraph2D<GraphNode, GraphLink>
        ref={graphRef}
        graphData={graphData}
        width={size.w || undefined}
        height={size.h || undefined}
        nodeRelSize={4}
        // Arrastar nó nunca foi um recurso oferecido por esta tela (não tem
        // "solte pra fixar" nem nada do tipo) — só o default da biblioteca.
        // Desativado porque competia pelo mesmo toque com a detecção manual
        // de long-press acima (um toque parado podia começar a virar um
        // "arrasto" de 1-2px antes do temporizador disparar, cancelando o
        // menu de contexto por causa da tolerância de movimento).
        enableNodeDrag={false}
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        linkColor={linkColor}
        linkWidth={(l) => ((l as GraphLink).kind === 'summary' ? 1.5 : 1)}
        linkLineDash={(l) => ((l as GraphLink).kind === 'summary' ? [4, 4] : null)}
        onNodeClick={handleNodeClick}
        onNodeRightClick={handleNodeRightClick}
        onEngineStop={handleEngineStop}
        onRenderFramePost={syncPreviewOverlay}
        cooldownTicks={100}
      />

      <div className="obsidian-graph-controls">
        <button
          type="button"
          onClick={() => graphRef.current?.zoom((graphRef.current.zoom() || 1) * 1.3, 200)}
          aria-label="Aumentar zoom"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => graphRef.current?.zoom((graphRef.current.zoom() || 1) / 1.3, 200)}
          aria-label="Diminuir zoom"
        >
          −
        </button>
        <button type="button" onClick={() => graphRef.current?.zoomToFit(400, 40)}>
          Ajustar
        </button>
      </div>

      {ghostWarning && <p className="error obsidian-status-line obsidian-graph-warning">{ghostWarning}</p>}

      {/* Sem botão de fechar/editar flutuando no cartão: um toque simples
          nele fecha o preview (ver o efeito de long-press/toque acima), e
          "Editar" mora no menu de contexto (segurar em cima do cartão). */}
      {previewId && previewNode && (
        previewNode.kind === 'note' ? (
          <ObsidianNoteGraphCard ref={cardRef} note={vault.state.notes.get(previewId)} />
        ) : (
          <ObsidianFilePreviewCard
            ref={cardRef}
            fileId={previewId}
            mimeType={previewNode.mimeType ?? ''}
            readFileBytes={vault.readFilePreview}
          />
        )
      )}

      {/* Menu de contexto (segurar em cima de um nó) — ver handleNodeRightClick */}
      {actionNode && (
        <>
          <div className="obsidian-conflict-backdrop" aria-hidden="true" onClick={() => setActionNode(null)} />
          <div className="obsidian-node-menu" role="menu" aria-label={`Ações para ${actionNode.name}`}>
            <p className="obsidian-node-menu-title">{actionNode.name}</p>
            {/* Só pra nota — igual ao botão "Editar" que morava na barra
                flutuante do cartão de preview, agora aqui pra qualquer nota
                (em preview ou não). */}
            {actionNode.kind === 'note' && (
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
            <button type="button" onClick={() => handleTogglePin(actionNode)}>
              {pinnedPositionsRef.current.has(actionNode.id) ? 'Soltar posição' : 'Fixar posição'}
            </button>
            {/* Excluir só pra nota/arquivo — nunca pasta, ver handleDeleteNode */}
            {actionNode.kind !== 'folder' && (
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
        <ObsidianRenameDialog
          title={`Renomear "${renameTarget.name}"`}
          initialValue={renameTarget.kind === 'note' ? stripMdExtension(renameTarget.name) : renameTarget.name}
          onCancel={() => setRenameTarget(null)}
          onSave={(newValue) => void handleRenameNode(renameTarget, newValue)}
        />
      )}

      {moveTarget && (
        <ObsidianMoveDialog
          vault={vault}
          itemName={moveTarget.name}
          excludeFolderId={moveTarget.id}
          onCancel={() => setMoveTarget(null)}
          onMoveTo={(destFolderId) => void handleMoveNode(moveTarget, destFolderId)}
        />
      )}

      {actionStatus && (
        <p className="error obsidian-status-line obsidian-graph-warning">{actionStatus}</p>
      )}
    </div>
  );
}
