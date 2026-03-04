import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { NodeData, EdgeData, PacketEvent } from '../types';
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
  threeDLinkOpacity: number;
  threeDLabelSize: number;
  orbit: boolean;
  geoInfluence: number;
  showPacketAnimation: boolean;
  maxRenderedPackets: number;
}

export function projectGeo(
  nodes: NodeData[],
  scale = 400,
  center?: { lat: number; lng: number },
): Map<string, { x: number; y: number }> {
  type Located = NodeData & { latitude: number; longitude: number };
  const located = nodes.filter((n): n is Located => n.latitude != null && n.longitude != null);
  if (located.length === 0) return new Map();

  const lats = located.map((n) => n.latitude);
  const lons = located.map((n) => n.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const span = Math.max(maxLat - minLat, maxLon - minLon) || 1;

  const midLat = center?.lat ?? located.reduce((s, n) => s + n.latitude, 0) / located.length;
  const midLon = center?.lng ?? located.reduce((s, n) => s + n.longitude, 0) / located.length;

  const result = new Map<string, { x: number; y: number }>();
  for (const n of located) {
    result.set(n.hash, {
      x: ((n.longitude - midLon) / span) * scale,
      y: -((n.latitude - midLat) / span) * scale,
    });
  }
  return result;
}

interface Props {
  nodes: NodeData[];
  edges: EdgeData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  settings: GraphSettings;
  recentPackets: PacketEvent[];
  packetAnimationEnabled: boolean;
  geoCenter?: { lat: number; lng: number } | null;
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
  bidirectional: boolean;
}

interface ActivePacket {
  id: number;
  path: string[];
  startedAt: number;
  totalDurationMs: number;
}

function nodeRadius(settings: GraphSettings): number {
  return settings.minNodeRadius;
}

function edgeWidth(e: EdgeData): number {
  return Math.max(1, Math.min(e.packet_count / 8, 6));
}

function totalDurationMs(packet: PacketEvent): number {
  const hopCount = Math.max(1, packet.path.length - 1);
  if (packet.duration != null && Number.isFinite(packet.duration)) {
    return Math.max(120, Math.min(packet.duration, 6000));
  }
  return Math.max(200, Math.min(hopCount * 250, 4000));
}

export function NetworkGraph({ nodes, edges, selectedId, onSelect, settings, recentPackets, packetAnimationEnabled, geoCenter }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const zoomGRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkRef = useRef<d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown> | null>(null);
  const nodeRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null);
  const packetRef = useRef<d3.Selection<SVGCircleElement, ActivePacket, SVGGElement, unknown> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const topologyKeyRef = useRef('');
  const forceKeyRef = useRef('');
  const activePacketsRef = useRef<ActivePacket[]>([]);
  const consumedPacketIdRef = useRef(-1);
  const packetRafRef = useRef<number | null>(null);

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
    const packetLayer = zoomG.append('g').attr('class', 'packets');
    const nodeLayer = zoomG.append('g').attr('class', 'nodes');

    linkRef.current = linkLayer.selectAll<SVGLineElement, SimEdge>('line');
    packetRef.current = packetLayer.selectAll<SVGCircleElement, ActivePacket>('circle');
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
      if (packetRafRef.current !== null) cancelAnimationFrame(packetRafRef.current);
      d3.select(container).selectAll('*').remove();
      simRef.current = null;
    };
  }, [onSelect, settings.chargeStrength]);

  useEffect(() => {
    const sim = simRef.current;
    const zoomG = zoomGRef.current;
    if (!sim || !zoomG) return;

    const container = containerRef.current;
    const W = container?.clientWidth ?? 800;
    const H = container?.clientHeight ?? 600;

    const geoMap = projectGeo(nodes, 400, geoCenter ?? undefined);

    const simNodes: SimNode[] = nodes.map((n) => {
      const existing = simNodesRef.current.find((s) => s.hash === n.hash);
      if (existing) {
        Object.assign(existing, n);
        return existing;
      }
      const prior = posRef.current.get(n.hash);
      return {
        ...n,
        x: prior?.x ?? (W / 2 + (Math.random() - 0.5) * 80),
        y: prior?.y ?? (H / 2 + (Math.random() - 0.5) * 80),
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      };
    });
    simNodesRef.current = simNodes;

    const nodeById = new Map(simNodes.map((n) => [n.hash, n]));

    const seenPairs = new Map<string, SimEdge>();
    for (const e of edges) {
      if (!nodeById.has(e.from_hash) || !nodeById.has(e.to_hash)) continue;
      const canonical = [e.from_hash, e.to_hash].sort().join('<>');
      if (seenPairs.has(canonical)) {
        seenPairs.get(canonical)!.bidirectional = true;
      } else {
        seenPairs.set(canonical, {
          ...e,
          source: nodeById.get(e.from_hash)!,
          target: nodeById.get(e.to_hash)!,
          bidirectional: false,
        });
      }
    }
    const simEdges = [...seenPairs.values()];

    const linkLayer = zoomG.select<SVGGElement>('g.links');
    linkRef.current = linkLayer
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges, (d) => [d.from_hash, d.to_hash].sort().join('<>'))
      .join('line')
      .attr('stroke', '#2563eb')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', (d) => edgeWidth(d));

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

    const degreeMap = new Map<string, number>();
    for (const e of simEdges) {
      degreeMap.set(e.from_hash, (degreeMap.get(e.from_hash) ?? 0) + 1);
      degreeMap.set(e.to_hash, (degreeMap.get(e.to_hash) ?? 0) + 1);
    }
    const maxDegree = Math.max(1, ...degreeMap.values());
    sim.force<d3.ForceManyBody<SimNode>>('charge')?.strength((node: SimNode) => {
      const degree = degreeMap.get(node.hash) ?? 0;
      return settings.chargeStrength * (1 + 2 * (degree / maxDegree));
    });

    sim.force<d3.ForceCollide<SimNode>>('collide')?.radius(() => nodeRadius(settings) + 10);

    if (settings.geoInfluence > 0 && geoMap.size > 0) {
      sim.force('geoX',
        d3.forceX<SimNode>((n) => {
          const p = geoMap.get(n.hash);
          return p ? W / 2 + p.x : W / 2;
        }).strength((n) => (geoMap.has(n.hash) ? settings.geoInfluence : 0))
      );
      sim.force('geoY',
        d3.forceY<SimNode>((n) => {
          const p = geoMap.get(n.hash);
          return p ? H / 2 + p.y : H / 2;
        }).strength((n) => (geoMap.has(n.hash) ? settings.geoInfluence : 0))
      );
    } else {
      sim.force('geoX', null);
      sim.force('geoY', null);
    }

    sim.nodes(simNodes);

    const topologyKey = [
      simNodes.map((n) => n.hash).join('|'),
      simEdges.map((e) => `${e.from_hash}->${e.to_hash}`).join('|'),
    ].join('::');
    const forceKey = [
      settings.linkDistance,
      settings.linkStrength,
      settings.chargeStrength,
      settings.minNodeRadius,
      settings.geoInfluence,
    ].join('|');

    if (topologyKeyRef.current !== topologyKey || forceKeyRef.current !== forceKey) {
      sim.alpha(Math.min(0.2, 0.08 + simEdges.length * 0.004)).restart();
      setTimeout(() => sim.alphaTarget(0), 500);
      topologyKeyRef.current = topologyKey;
      forceKeyRef.current = forceKey;
    }
  }, [nodes, edges, onSelect, settings, geoCenter]);

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
  }, [nodes, selectedId, settings]);

  useEffect(() => {
    const zoomG = zoomGRef.current;
    if (!zoomG) return;

    const shouldAnimate = packetAnimationEnabled && settings.showPacketAnimation;
    if (!shouldAnimate) {
      activePacketsRef.current = [];
      packetRef.current = zoomG.select<SVGGElement>('g.packets').selectAll<SVGCircleElement, ActivePacket>('circle');
      packetRef.current.data([]).join('circle');
      if (packetRafRef.current !== null) {
        cancelAnimationFrame(packetRafRef.current);
        packetRafRef.current = null;
      }
      return;
    }

    for (const packet of [...recentPackets].reverse()) {
      if (packet.id <= consumedPacketIdRef.current) continue;
      consumedPacketIdRef.current = packet.id;
      if (packet.path.length < 2) continue;
      activePacketsRef.current.push({
        id: packet.id,
        path: packet.path,
        startedAt: Date.now(),
        totalDurationMs: totalDurationMs(packet),
      });
    }

    if (activePacketsRef.current.length > settings.maxRenderedPackets) {
      activePacketsRef.current = activePacketsRef.current.slice(-settings.maxRenderedPackets);
    }

    const packetLayer = zoomG.select<SVGGElement>('g.packets');

    const tick = () => {
      const now = Date.now();
      activePacketsRef.current = activePacketsRef.current.filter((p) => now - p.startedAt < p.totalDurationMs);

      packetRef.current = packetLayer
        .selectAll<SVGCircleElement, ActivePacket>('circle')
        .data(activePacketsRef.current, (p) => String(p.id))
        .join('circle')
        .attr('r', 3)
        .attr('fill', '#fde047')
        .attr('stroke', '#f59e0b')
        .attr('stroke-width', 1.2)
        .attr('opacity', 0.95)
        .attr('pointer-events', 'none')
        .attr('cx', (p) => {
          const elapsed = now - p.startedAt;
          const segmentCount = p.path.length - 1;
          const segmentDuration = p.totalDurationMs / segmentCount;
          const segmentIndex = Math.min(segmentCount - 1, Math.floor(elapsed / segmentDuration));
          const progress = Math.max(0, Math.min(1, (elapsed - segmentIndex * segmentDuration) / segmentDuration));
          const from = posRef.current.get(p.path[segmentIndex]);
          const to = posRef.current.get(p.path[segmentIndex + 1]);
          if (!from || !to) return -9999;
          return from.x + (to.x - from.x) * progress;
        })
        .attr('cy', (p) => {
          const elapsed = now - p.startedAt;
          const segmentCount = p.path.length - 1;
          const segmentDuration = p.totalDurationMs / segmentCount;
          const segmentIndex = Math.min(segmentCount - 1, Math.floor(elapsed / segmentDuration));
          const progress = Math.max(0, Math.min(1, (elapsed - segmentIndex * segmentDuration) / segmentDuration));
          const from = posRef.current.get(p.path[segmentIndex]);
          const to = posRef.current.get(p.path[segmentIndex + 1]);
          if (!from || !to) return -9999;
          return from.y + (to.y - from.y) * progress;
        });

      packetRafRef.current = requestAnimationFrame(tick);
    };

    if (packetRafRef.current === null) {
      packetRafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (packetRafRef.current !== null) {
        cancelAnimationFrame(packetRafRef.current);
        packetRafRef.current = null;
      }
    };
  }, [recentPackets, packetAnimationEnabled, settings.showPacketAnimation, settings.maxRenderedPackets]);

  return <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }} />;
}
