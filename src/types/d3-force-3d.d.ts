// `force-graph` (usado por `react-force-graph-2d`) roda a simulação em cima
// de `d3-force-3d`, não do pacote `d3-force` padrão — e `d3-force-3d` não
// publica seus próprios tipos nem tem pacote `@types/*`. Declaração mínima
// só do que este projeto usa (`forceCollide`, pra evitar sobreposição de
// rótulos no GrafosGraphView) em vez de depender dos tipos de um pacote
// diferente do que está de fato instalado.
declare module 'd3-force-3d' {
  export interface ForceCollide<NodeDatum> {
    (alpha: number): void;
    initialize(nodes: NodeDatum[], random?: () => number): void;
    radius(radius: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)): ForceCollide<NodeDatum>;
    radius(): (node: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    strength(strength: number): ForceCollide<NodeDatum>;
    strength(): number;
    iterations(iterations: number): ForceCollide<NodeDatum>;
    iterations(): number;
  }

  export function forceCollide<NodeDatum = unknown>(
    radius?: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number),
  ): ForceCollide<NodeDatum>;
}
