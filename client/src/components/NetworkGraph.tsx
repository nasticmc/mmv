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

interface SimNode extends NodeData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

interface SimEdge extends EdgeData {
  source: SimNode;
  target: SimNode;
}

function nodeRadius(settings: GraphSettings): number {
  return settings.minNodeRadius;
}

function edgeWidth(e: EdgeData): number {
  return Math.max(1, Math.min(e.packet_count / 8, 6));
}

export function NetworkGraph({ nodes, edges, selectedId, onSelect, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const zoomGRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkRef = useRef<d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown> | null>(null);
  const nodeRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container || simRef.current) return;

    const W = container.clientWidth;
    const H = container.clientHeight;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', W)
      .attr('height', H)
      .style('background', '#030712');

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

    const zoomG = svg.append('g');
    zoomGRef.current = zoomG;

    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 15])
        .on('zoom', (e) => {
          zoomG.attr('transform', e.transform.toString());
        })
    );

    svg.on('click', () => onSelect(null));

    const linkLayer = zoomG.append('g').attr('class', 'links');
    const nodeLayer = zoomG.append('g').attr('class', 'nodes');

    linkRef.current = linkLayer.selectAll<SVGLineElement, SimEdge>('line');
    nodeRef.current = nodeLayer.selectAll<SVGGElement, SimNode>('g');

    const sim = d3
      .forceSimulation<SimNode>([])
      .force('link', d3.forceLink<SimNode, SimEdge>([]).id((d) => d.hash))
      .force('charge', d3.forceManyBody<SimNode>().strength(settings.chargeStrength))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collide', d3.forceCollide<SimNode>(() => nodeRadius(settings) + 10));

    sim.on('tick', () => {
      linkRef.current
        ?.attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      nodeRef.current?.attr('transform', (d) => `translate(${d.x},${d.y})`);
      simNodesRef.current.forEach((n) => posRef.current.set(n.hash, { x: n.x, y: n.y }));
    });

    simRef.current = sim;

    return () => {
      sim.stop();
      d3.select(container).selectAll('*').remove();
      simRef.current = null;
    };
  }, [onSelect, settings.chargeStrength, settings.minNodeRadius]);

  useEffect(() => {
    const sim = simRef.current;
    const zoomG = zoomGRef.current;
    if (!sim || !zoomG) return;

    const container = containerRef.current;
    const W = container?.clientWidth ?? 800;
    const H = container?.clientHeight ?? 600;

    const simNodes: SimNode[] = nodes.map((n) => {
      const existing = simNodesRef.current.find((s) => s.hash === n.hash);
      if (existing) {
        Object.assign(existing, n);
        return existing;
      }
      const saved = posRef.current.get(n.hash);
      return {
        ...n,
        x: saved?.x ?? W / 2 + (Math.random() - 0.5) * 120,
        y: saved?.y ?? H / 2 + (Math.random() - 0.5) * 120,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      };
    });

    simNodesRef.current = simNodes;

    const nodeById = new Map(simNodes.map((n) => [n.hash, n]));
    const simEdges: SimEdge[] = edges
      .filter((e) => nodeById.has(e.from_hash) && nodeById.has(e.to_hash))
      .map((e) => ({ ...e, source: nodeById.get(e.from_hash)!, target: nodeById.get(e.to_hash)! }));

    const linkLayer = zoomG.select<SVGGElement>('g.links');
    linkRef.current = linkLayer
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges, (d) => `${d.from_hash}->${d.to_hash}`)
      .join('line')
      .attr('stroke', '#2563eb')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', (d) => edgeWidth(d))
      .attr('marker-end', 'url(#arrow)');

    const nodeLayer = zoomG.select<SVGGElement>('g.nodes');
    const nodeSelection = nodeLayer
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d) => d.hash)
      .join((enter) => {
        const group = enter
          .append('g')
          .attr('class', 'node')
          .style('cursor', 'pointer')
          .on('click', (e, d) => {
            e.stopPropagation();
            onSelect(d.hash);
          });

        group.append('circle').attr('class', 'glow').attr('fill', 'none').attr('stroke-width', 2).attr('opacity', 0.6);
        group.append('circle').attr('class', 'main');
        group.append('text').attr('class', 'label').attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', '11px').attr('font-family', 'monospace').style('pointer-events', 'none').style('user-select', 'none');
        group.append('text').attr('class', 'badge').attr('text-anchor', 'middle').attr('fill', '#6b7280').attr('font-size', '9px').style('pointer-events', 'none').style('user-select', 'none');

        return group;
      });

    nodeSelection.call(
      d3
        .drag<SVGGElement, SimNode>()
        .on('start', (e, d) => {
          if (!e.active) sim.alphaTarget(0.2).restart();
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
    );

    nodeRef.current = nodeSelection;

    const linkForce = sim.force<d3.ForceLink<SimNode, SimEdge>>('link');
    linkForce?.links(simEdges).distance(settings.linkDistance).strength(settings.linkStrength);
    sim.force<d3.ForceManyBody<SimNode>>('charge')?.strength(settings.chargeStrength);
    sim.force<d3.ForceCollide<SimNode>>('collide')?.radius(() => nodeRadius(settings) + 10);

    sim.nodes(simNodes);
    sim.alpha(Math.min(0.22, 0.08 + simEdges.length * 0.004)).restart();
    setTimeout(() => sim.alphaTarget(0), 600);
  }, [nodes, edges, onSelect, settings]);

  useEffect(() => {
    nodeRef.current?.select<SVGCircleElement>('circle.glow')
      .attr('r', nodeRadius(settings) + 6)
      .attr('stroke', (d) => (d.hash === selectedId ? '#fbbf24' : 'none'));

    nodeRef.current?.select<SVGCircleElement>('circle.main')
      .attr('r', nodeRadius(settings))
      .attr('fill', (d) => ROLE_COLORS[d.device_role] ?? ROLE_COLORS[0])
      .attr('stroke', (d) => (d.hash === selectedId ? '#fbbf24' : '#1f2937'))
      .attr('stroke-width', (d) => (d.hash === selectedId ? 2.5 : 1.5));

    nodeRef.current?.select<SVGTextElement>('text.label')
      .text((d) => (settings.showLabels ? (d.name ?? d.hash.toUpperCase()) : ''))
      .attr('dy', -(nodeRadius(settings) + 6));

    nodeRef.current?.select<SVGTextElement>('text.badge')
      .text((d) => (settings.showPacketBadges && d.packet_count > 0 ? d.packet_count : ''))
      .attr('dy', nodeRadius(settings) + 14);
  }, [selectedId, settings]);

  return <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }} />;
}
