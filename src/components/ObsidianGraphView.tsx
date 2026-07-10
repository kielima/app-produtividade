import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { buildGraphData, type GraphLink, type GraphNode } from '../lib/obsidianGraph';
import { filterExactNameMatches } from '../lib/obsidianBacklinks';
import type { useObsidianVault } from '../lib/obsidianTree';
import { ObsidianNotePreviewOverlay } from './ObsidianNotePreviewOverlay';

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
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const [ghostWarning, setGhostWarning] = useState<string | null>(null);
  const colors = useGraphColors();
  const didInitialFitRef = useRef(false);

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

  // Repulsão/distância padrão do force-graph deixa os círculos praticamente
  // encostados um no outro (difícil de tocar o certo no celular) — aumenta o
  // espaçamento pra cada nó ficar mais isolado e legível.
  useEffect(() => {
    graphRef.current?.d3Force('charge')?.strength(-160);
    graphRef.current?.d3Force('link')?.distance(70);
  }, [graphData]);

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
        setPreviewNoteId(n.id);
        void vault.openNote(n.id, { name: n.name });
        return;
      }
      if (n.kind === 'ghost') {
        setPreviewNoteId(null);
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
      // 'file': sem ação, mesmo padrão da árvore (linha desabilitada).
    },
    [vault],
  );

  const nodeCanvasObject = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode & { x?: number; y?: number };
      if (n.x == null || n.y == null) return;
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
    [colors],
  );

  const linkColor = useCallback(
    (link: GLink) => {
      const kind = (link as GraphLink).kind;
      return kind === 'containment' ? colors.containment : kind === 'summary' ? colors.summary : colors.note;
    },
    [colors],
  );

  return (
    <div className="obsidian-graph-view" ref={containerRef}>
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
        linkDirectionalArrowLength={(l) => ((l as GraphLink).kind === 'wikilink' ? 5 : 0)}
        onNodeClick={handleNodeClick}
        onEngineStop={handleEngineStop}
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

      {previewNoteId && (
        <ObsidianNotePreviewOverlay
          name={vault.state.notes.get(previewNoteId)?.name || previewNoteId}
          note={vault.state.notes.get(previewNoteId)}
          onClose={() => setPreviewNoteId(null)}
          onEdit={() => {
            onEditNote(previewNoteId);
            setPreviewNoteId(null);
          }}
        />
      )}
    </div>
  );
}
