import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { buildGraphData, type GraphLink, type GraphNode, type GraphNodeKind } from '../lib/obsidianGraph';
import { filterExactNameMatches } from '../lib/obsidianBacklinks';
import { driveIconKind } from '../lib/driveFileIcons';
import type { useObsidianVault } from '../lib/obsidianTree';
import { ObsidianNoteGraphCard } from './ObsidianNoteGraphCard';
import { ObsidianFilePreviewCard } from './ObsidianFilePreviewCard';

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
}: {
  vault: Vault;
  onEditNote: (fileId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [ghostWarning, setGhostWarning] = useState<string | null>(null);
  const colors = useGraphColors();
  const didInitialFitRef = useRef(false);

  // Posição (mundo) do nó em preview, atualizada a cada frame dentro de
  // `nodeCanvasObject` — lida logo em seguida por `syncPreviewOverlay`
  // (mesmo frame) pra posicionar o cartão HTML. Fica numa ref (não state)
  // porque muda a ~60fps durante pan/zoom; um `setState` nessa frequência
  // re-renderizaria a árvore React inteira sem necessidade.
  const previewNodePosRef = useRef<{ x: number; y: number; kind: GraphNodeKind } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

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

  const graphData = useMemo(() => buildGraphData(vault.state), [vault.state]);
  // Kind/mimeType do nó em preview (pra decidir qual cartão renderizar) —
  // dado estático, já disponível em `graphData` sem precisar esperar o
  // próximo frame do canvas (diferente de `previewNodePosRef`, que só tem
  // x/y, que SIM muda a cada frame durante a simulação/pan/zoom).
  const previewNode = previewId ? graphData.nodes.find((n) => n.id === previewId) : undefined;

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
  // não abrir numa parte aleatória do grafo. Não repete depois disso (ex.: ao
  // expandir uma pasta) pra não "puxar o tapete" de onde o usuário estava
  // navegando — pra isso o botão "Ajustar" já existe.
  const handleEngineStop = useCallback(() => {
    if (didInitialFitRef.current) return;
    didInitialFitRef.current = true;
    graphRef.current?.zoomToFit(400, 60);
  }, []);

  const handleNodeClick = useCallback(
    (node: GNode) => {
      const n = node as GraphNode;
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
      // A4 neles ia distorcer/preencher com espaço em branco à toa.
      card.style.minHeight = pos.kind === 'note' ? `${width * A4_RATIO}px` : '';
      card.style.fontSize = `${fontSize}px`;
    }
    const actions = actionsRef.current;
    if (actions) {
      actions.style.left = `${screen.x + width / 2}px`;
      actions.style.top = `${screen.y}px`;
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
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        linkColor={linkColor}
        linkWidth={(l) => ((l as GraphLink).kind === 'summary' ? 1.5 : 1)}
        linkLineDash={(l) => ((l as GraphLink).kind === 'summary' ? [4, 4] : null)}
        onNodeClick={handleNodeClick}
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

      {previewId && previewNode && (
        <>
          {previewNode.kind === 'note' ? (
            <ObsidianNoteGraphCard ref={cardRef} note={vault.state.notes.get(previewId)} />
          ) : (
            <ObsidianFilePreviewCard
              ref={cardRef}
              fileId={previewId}
              mimeType={previewNode.mimeType ?? ''}
              readFileBytes={vault.readFilePreview}
            />
          )}
          <div ref={actionsRef} className="obsidian-note-graph-card-actions">
            <button type="button" onClick={() => setPreviewId(null)} aria-label="Fechar preview">
              ×
            </button>
            {previewNode.kind === 'note' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onEditNote(previewId);
                  setPreviewId(null);
                }}
              >
                Editar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
