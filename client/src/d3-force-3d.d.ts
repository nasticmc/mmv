// Minimal TypeScript declarations for the d3-force-3d package.
// The library is a 3D-capable fork of d3-force; this shim covers only what we use.
declare module 'd3-force-3d' {
  export interface SimNode3D {
    index?: number;
    x?: number; y?: number; z?: number;
    vx?: number; vy?: number; vz?: number;
    fx?: number | null; fy?: number | null; fz?: number | null;
  }

  export interface SimLink3D<N> {
    source: N | string | number;
    target: N | string | number;
    index?: number;
  }

  export interface Simulation3D<N extends SimNode3D> {
    tick(iterations?: number): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(min: number): this;
    alphaDecay(): number;
    alphaDecay(decay: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    velocityDecay(): number;
    velocityDecay(decay: number): this;
    force(name: string): any;
    force(name: string, force: any | null): this;
    find(x: number, y: number, z?: number, radius?: number): N | undefined;
    on(typenames: string): any;
    on(typenames: string, listener: (this: this) => void): this;
    restart(): this;
    stop(): this;
  }

  export interface ForceLink3D<N extends SimNode3D, L extends SimLink3D<N>> {
    (alpha: number): void;
    links(): L[];
    links(links: L[]): this;
    id(): (node: N) => string | number;
    id(id: (node: N) => string | number): this;
    distance(): number | ((link: L) => number);
    distance(d: number | ((link: L) => number)): this;
    strength(): number | ((link: L) => number);
    strength(s: number | ((link: L) => number)): this;
    iterations(): number;
    iterations(n: number): this;
  }

  export interface ForceManyBody3D<N extends SimNode3D> {
    (alpha: number): void;
    strength(): number | ((node: N) => number);
    strength(s: number | ((node: N) => number)): this;
    theta(): number;
    theta(t: number): this;
    distanceMin(): number;
    distanceMin(d: number): this;
    distanceMax(): number;
    distanceMax(d: number): this;
  }

  export interface ForceCenter3D<N extends SimNode3D> {
    (alpha: number): void;
    x(): number; x(v: number): this;
    y(): number; y(v: number): this;
    z(): number; z(v: number): this;
    strength(): number; strength(s: number): this;
  }

  export interface ForceAxis3D<N extends SimNode3D> {
    (alpha: number): void;
    strength(): number | ((node: N) => number);
    strength(s: number | ((node: N) => number)): this;
    x(v?: number | ((node: N) => number)): this | number | ((node: N) => number);
  }

  export function forceSimulation<N extends SimNode3D>(
    nodes?: N[],
    numDimensions?: number,
  ): Simulation3D<N>;

  export function forceLink<N extends SimNode3D, L extends SimLink3D<N>>(
    links?: L[],
  ): ForceLink3D<N, L>;

  export function forceManyBody<N extends SimNode3D>(): ForceManyBody3D<N>;
  export function forceCenter<N extends SimNode3D>(x?: number, y?: number, z?: number): ForceCenter3D<N>;
  export function forceX<N extends SimNode3D>(x?: number | ((n: N) => number)): ForceAxis3D<N>;
  export function forceY<N extends SimNode3D>(y?: number | ((n: N) => number)): ForceAxis3D<N>;
  export function forceZ<N extends SimNode3D>(z?: number | ((n: N) => number)): ForceAxis3D<N>;
}
