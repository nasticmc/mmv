import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { NodeData, EdgeData } from '../types';
import { ROLE_COLORS } from '../types';

export interface GraphSettings {
  minNodeRadius: number;
  maxNodeRadius: number;
  linkDistance: number;
  linkStrength: number;
  chargeStrength: number;
  showLabels: boolean;
  showPacketBadges: boolean;
  mode: '2d' | '3d';
}

interface Props {
  nodes: NodeData[];
  edges: EdgeData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  settings: GraphSettings;
}

// D3 simulation node (extends NodeData with layout props)
interface SimNode extends NodeData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

// D3 simulation edge
interface SimEdge extends EdgeData {
  source: SimNode;
  target: SimNode;
}

function buildConnectionCount(edges: EdgeData[]): Map<string, number> {
  const degreeByNode = new Map<string, number>();
  for (const edge of edges) {
    degreeByNode.set(edge.from_hash, (degreeByNode.get(edge.from_hash) ?? 0) + 1);
    degreeByNode.set(edge.to_hash, (degreeByNode.get(edge.to_hash) ?? 0) + 1);
  }
  return degreeByNode;
}

function nodeRadius(hash: string, degreeByNode: Map<string, number>, settings: GraphSettings): number {
  const connections = degreeByNode.get(hash) ?? 0;
  const scaled = settings.minNodeRadius + connections * 2;
  return Math.max(settings.minNodeRadius, Math.min(scaled, settings.maxNodeRadius));
}

function edgeWidth(e: EdgeData): number {
  return Math.max(1, Math.min(e.packet_count / 8, 6));
}

export function NetworkGraph({ nodes, edges, selectedId, onSelect, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const focusPendingRef = useRef<string | null>(null);
  // Preserve node positions across renders
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Preserve zoom/pan so data updates don't reset the viewport
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const degreeByNode = buildConnectionCount(edges);

    // Stop previous simulation
    simRef.current?.stop();

    const W = container.clientWidth;
    const H = container.clientHeight;

    // Clear container
    d3.select(container).selectAll('*').remove();

    // --- SVG setup ---
    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', W)
      .attr('height', H)
      .style('background', '#030712'); // gray-950

    // Arrow marker for directed edges
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#2563eb');

    // Zoom / pan
    const zoomG = svg.append('g');
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 15])
      .on('zoom', (e) => {
        zoomTransformRef.current = e.transform;
        zoomG.attr('transform', e.transform.toString());
      });
    svg.call(zoom);
    svg.call(zoom.transform, zoomTransformRef.current);
    svgRef.current = svg;
    zoomRef.current = zoom;

    // Click on background deselects
    svg.on('click', () => onSelect(null));

    // --- Build simulation nodes preserving positions ---
    const simNodes: SimNode[] = nodes.map((n) => {
      const saved = posRef.current.get(n.hash);
      return {
        ...n,
        x: saved?.x ?? W / 2 + (Math.random() - 0.5) * 200,
        y: saved?.y ?? H / 2 + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      };
    });

    const nodeById = new Map(simNodes.map((n) => [n.hash, n]));

    const simEdges: SimEdge[] = edges
      .filter((e) => nodeById.has(e.from_hash) && nodeById.has(e.to_hash))
      .map((e) => ({
        ...e,
        source: nodeById.get(e.from_hash)!,
        target: nodeById.get(e.to_hash)!,
      }));

    // --- Force simulation ---
    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.hash)
          .distance(settings.linkDistance)
          .strength(settings.linkStrength)
      )
      .force('charge', d3.forceManyBody<SimNode>().strength(settings.chargeStrength))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collide', d3.forceCollide<SimNode>((d) => nodeRadius(d.hash, degreeByNode, settings) + 10));

    simRef.current = sim;

    // --- Draw edges ---
    const linkLayer = zoomG.append('g').attr('class', 'links');
    const link = linkLayer
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', (d) => (
        selectedId && (d.from_hash === selectedId || d.to_hash === selectedId)
          ? '#fbbf24'
          : '#2563eb'
      ))
      .attr('stroke-opacity', (d) => {
        if (!selectedId) return 0.7;
        return d.from_hash === selectedId || d.to_hash === selectedId ? 0.95 : 0.15;
      })
      .attr('stroke-width', (d) => {
        const width = edgeWidth(d);
        if (selectedId && (d.from_hash === selectedId || d.to_hash === selectedId)) {
          return width + 1;
        }
        return width;
      })
      .attr('marker-end', 'url(#arrow)');

    // --- Draw nodes ---
    const nodeLayer = zoomG.append('g').attr('class', 'nodes');
    const node = nodeLayer
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (d) => d.hash)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (e, d) => {
            if (!e.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (e, d) => {
            d.fx = e.x;
            d.fy = e.y;
          })
          .on('end', (e, d) => {
            if (!e.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on('click', (e, d) => {
        e.stopPropagation();
        onSelect(d.hash);
      });

    // Glow effect for selected node
    node
      .append('circle')
      .attr('class', 'glow')
      .attr('r', (d) => nodeRadius(d.hash, degreeByNode, settings) + 6)
      .attr('fill', 'none')
      .attr('stroke', (d) => (d.hash === selectedId ? '#fbbf24' : 'none'))
      .attr('stroke-width', 2)
      .attr('opacity', 0.6);

    // Main circle
    node
      .append('circle')
      .attr('r', (d) => nodeRadius(d.hash, degreeByNode, settings))
      .attr('fill', (d) => ROLE_COLORS[d.device_role] ?? ROLE_COLORS[0])
      .attr('fill-opacity', (d) => {
        if (!selectedId) return 1;
        if (d.hash === selectedId) return 1;
        const connectedToSelected = simEdges.some((e) =>
          (e.from_hash === selectedId && e.to_hash === d.hash) ||
          (e.to_hash === selectedId && e.from_hash === d.hash)
        );
        return connectedToSelected ? 0.95 : 0.35;
      })
      .attr('stroke', (d) => (d.hash === selectedId ? '#fbbf24' : '#1f2937'))
      .attr('stroke-width', (d) => (d.hash === selectedId ? 2.5 : 1.5));

    if (settings.showLabels) {
      // Label
      node
        .append('text')
        .text((d) => d.name ?? d.hash.toUpperCase())
        .attr('dy', (d) => -(nodeRadius(d.hash, degreeByNode, settings) + 6))
        .attr('text-anchor', 'middle')
        .attr('fill', '#9ca3af')
        .attr('font-size', '11px')
        .attr('font-family', 'monospace')
        .style('pointer-events', 'none')
        .style('user-select', 'none');
    }

    if (settings.showPacketBadges) {
      // Packet count badge (small circle + number) for active nodes
      node
        .filter((d) => d.packet_count > 0)
        .append('text')
        .text((d) => d.packet_count)
        .attr('dy', (d) => nodeRadius(d.hash, degreeByNode, settings) + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7280')
        .attr('font-size', '9px')
        .style('pointer-events', 'none')
        .style('user-select', 'none');
    }

    // --- Tick ---
    sim.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);

      // Save positions
      simNodes.forEach((n) => posRef.current.set(n.hash, { x: n.x, y: n.y }));

      if (focusPendingRef.current) {
        const target = simNodes.find((n) => n.hash === focusPendingRef.current);
        const svgNode = svgRef.current;
        const zoomBehavior = zoomRef.current;
        if (target && svgNode && zoomBehavior) {
          const current = zoomTransformRef.current;
          const scale = Math.max(current.k, 1.15);
          const next = d3.zoomIdentity
            .translate(W / 2 - target.x * scale, H / 2 - target.y * scale)
            .scale(scale);
          svgNode
            .transition()
            .duration(350)
            .call(zoomBehavior.transform, next);
          focusPendingRef.current = null;
        }
      }
    });

    // Slow down after initial layout
    sim.alpha(nodes.length > 0 ? 1 : 0).restart();
    setTimeout(() => sim.alphaTarget(0), 3000);

    return () => { sim.stop(); };
  }, [nodes, edges, selectedId, onSelect, settings]);

  useEffect(() => {
    focusPendingRef.current = selectedId;
  }, [selectedId]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      // Re-trigger by simulating a small state change would require prop change
      // For simplicity, we rely on the main useEffect to rebuild on data updates
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden"
      style={{ minHeight: 0 }}
    />
  );
}
