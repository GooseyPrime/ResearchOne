/**
 * Minimal ambient fallback for 'd3' used when @types/d3 is not installed locally.
 * When @types/d3 IS installed (e.g. in CI), TypeScript resolves the real module types
 * from node_modules/@types/d3 and this ambient declaration is ignored entirely.
 *
 * Only the types and functions used in EmbeddingAtlasPage and KnowledgeGraphPage
 * are declared here.
 */
declare module 'd3' {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface SimulationLinkDatum<N = any> {
    source: N | string | number;
    target: N | string | number;
    index?: number;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface Simulation<N extends SimulationNodeDatum = SimulationNodeDatum, L = any> {
    stop(): this;
    restart(): this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(typenames: string, listener: (...args: any[]) => void): this;
    alphaTarget(alpha: number): this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    force(name: string, force: any): this;
  }

  export interface ZoomBehavior<
    ZoomRefElement extends Element = Element,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Datum = any,
  > {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selection: any): void;
    scaleExtent(extent: [number, number]): this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(typenames: string, listener: (...args: any[]) => void): this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scaleBy(selection: any, k: number): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform(selection: any, transform: any): void;
  }

  export function zoom<
    ZoomRefElement extends Element = Element,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Datum = any,
  >(): ZoomBehavior<ZoomRefElement, Datum>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function select(node: any): any;

  export function forceSimulation<N extends SimulationNodeDatum>(nodes?: N[]): Simulation<N>;

  export function forceLink<
    N extends SimulationNodeDatum,
    L extends SimulationLinkDatum<N>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  >(links?: L[]): any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceManyBody(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceCollide(radius?: number): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceCenter(x?: number, y?: number): any;

  export function drag<
    GElement extends Element = Element,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Datum = any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  >(): any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function scaleLinear(...args: any[]): any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const zoomIdentity: any;
}
