import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { NodeData, EdgeData } from '../types';
import { ROLE_COLORS } from '../types';

interface Props {
  nodes: NodeData[];
  edges: EdgeData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
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

function nodeRadius(n: NodeData): number {
  return 9 + Math.min(n.packet_count / 15, 14);
}

function edgeWidth(e: EdgeData): number {
  return Math.max(1, Math.min(e.packet_count / 8, 6));
}

export function NetworkGraph({ nodes, edges, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  // Preserve node positions across renders
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Preserve zoom/pan so data updates don't reset the viewport
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      .attr('fill', '#374151');

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
          .distance(120)
          .strength(0.5)
      )
      .force('charge', d3.forceManyBody<SimNode>().strength(-350))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collide', d3.forceCollide<SimNode>((d) => nodeRadius(d) + 10));

    simRef.current = sim;

    // --- Draw edges ---
    const linkLayer = zoomG.append('g').attr('class', 'links');
    const link = linkLayer
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', '#374151')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', (d) => edgeWidth(d))
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
      .attr('r', (d) => nodeRadius(d) + 6)
      .attr('fill', 'none')
      .attr('stroke', (d) => (d.hash === selectedId ? '#fbbf24' : 'none'))
      .attr('stroke-width', 2)
      .attr('opacity', 0.6);

    // Main circle
    node
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => ROLE_COLORS[d.device_role] ?? ROLE_COLORS[0])
      .attr('stroke', (d) => (d.hash === selectedId ? '#fbbf24' : '#1f2937'))
      .attr('stroke-width', (d) => (d.hash === selectedId ? 2.5 : 1.5));

    // Label
    node
      .append('text')
      .text((d) => d.name ?? d.hash.toUpperCase())
      .attr('dy', (d) => -(nodeRadius(d) + 6))
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .style('pointer-events', 'none')
      .style('user-select', 'none');

    // Packet count badge (small circle + number) for active nodes
    node
      .filter((d) => d.packet_count > 0)
      .append('text')
      .text((d) => d.packet_count)
      .attr('dy', (d) => nodeRadius(d) + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6b7280')
      .attr('font-size', '9px')
      .style('pointer-events', 'none')
      .style('user-select', 'none');

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
    });

    // Slow down after initial layout
    sim.alpha(nodes.length > 0 ? 1 : 0).restart();
    setTimeout(() => sim.alphaTarget(0), 3000);

    return () => { sim.stop(); };
  }, [nodes, edges, selectedId, onSelect]);

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
