import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { buildGraphData, type GraphLink, type GraphNode, type GraphNodeKind } from '../lib/obsidianGraph';
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
  const actionsRef = useRef<HTMLDivElement>(null);

  // Posição conhecida de cada PASTA, por id — pastas formam o "esqueleto" da
  // árvore; abrir uma pasta ou um preview muda `vault.state` (então
  // `graphData` é recalculado do zero, com objetos de nó novos) e sem isso o
  // grafo inteiro se reacomodaria a cada clique. Notas/arquivos ficam de
  // fora de propósito — continuam livres pra reagir à repulsão do preview
  // (abaixo). Guardado numa ref (não recalculado a partir de `graphData`)
  // justamente pra sobreviver a esses recálculos.
  const folderPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

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

  // Toda vez que a simulação estabiliza: memoriza onde cada pasta parou (pra
  // reaplicar depois que `graphData` for recalculado — ver efeito abaixo).
  // Só a primeira vez chama `zoomToFit`, pra não abrir numa parte aleatória
  // do grafo sem "puxar o tapete" depois — pra isso o botão "Ajustar" existe.
  const handleEngineStop = useCallback(() => {
    for (const node of graphData.nodes) {
      const n = node as GraphNode & { x?: number; y?: number };
      if (n.kind === 'folder' && n.x != null && n.y != null) {
        folderPositionsRef.current.set(n.id, { x: n.x, y: n.y });
      }
    }
    if (didInitialFitRef.current) return;
    didInitialFitRef.current = true;
    graphRef.current?.zoomToFit(400, 60);
  }, [graphData]);

  // Reaplica (e fixa) a posição conhecida de cada pasta sempre que
  // `graphData` é recalculado — os objetos de nó são recriados do zero a
  // cada mudança de `vault.state` (inclusive ao só abrir um preview), então
  // sem isso as pastas perderiam a posição fixada e reacomodariam com o
  // resto. `fx`/`fy` (não só `x`/`y`) tira a pasta da física: ela só volta a
  // se mover se for removida daqui (não acontece hoje).
  useEffect(() => {
    for (const node of graphData.nodes) {
      const n = node as GraphNode & { x?: number; y?: number; fx?: number; fy?: number };
      if (n.kind !== 'folder') continue;
      const known = folderPositionsRef.current.get(n.id);
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

  // Segurar em cima de um nó (touch) dispara o evento nativo `contextmenu`
  // do navegador (long-press ~500ms no Android WebView/Chrome, igual clique-
  // direito no desktop) — `onNodeRightClick` já é o hook que a biblioteca
  // expõe pra isso, sem precisar de nenhum timer/gesto próprio. Raiz do
  // vault e nós fantasma (não são itens reais do Drive) não têm menu.
  const handleNodeRightClick = useCallback(
    (node: GNode, event: MouseEvent) => {
      const n = node as GraphNode;
      if (n.kind === 'ghost') return;
      if (n.kind === 'folder' && n.id === vault.state.rootId) return;
      event.preventDefault?.();
      setActionNode(n);
    },
    [vault.state.rootId],
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

      {/* Menu de contexto (segurar em cima de um nó) — ver handleNodeRightClick */}
      {actionNode && (
        <>
          <div className="obsidian-conflict-backdrop" aria-hidden="true" onClick={() => setActionNode(null)} />
          <div className="obsidian-node-menu" role="menu" aria-label={`Ações para ${actionNode.name}`}>
            <p className="obsidian-node-menu-title">{actionNode.name}</p>
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
