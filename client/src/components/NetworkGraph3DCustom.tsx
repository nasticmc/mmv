/**
 * NetworkGraph3DCustom — React wrapper for the GPU-instanced MeshRenderer.
 *
 * Owns the D3 3D force simulation and acts as the bridge between React state and
 * the imperative Three.js renderer.  React state mutations happen only when:
 *  - Graph topology changes (new nodes / edges arrive from WebSocket)
 *  - Settings change (link distance, charge strength, etc.)
 *  - Selected node or active packet hits change (colour updates)
 *
 * The D3 simulation tick directly calls renderer.updatePositions() — no React
 * setState on every tick, so there is no simulation-reheat jitter and no need
 * for the 30-second display throttle that existed in the old implementation.
 */

import { useRef, useEffect } from 'react';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceX,
  forceY,
} from 'd3-force-3d';
import type { Simulation3D, ForceLink3D, SimLink3D, SimNode3D } from 'd3-force-3d';
import { MeshRenderer } from './MeshRenderer';
import type { SimNode } from './MeshRenderer';
import { projectGeo } from '../lib/geo';
import type { EdgeData, InFlightPacket, NodeData } from '../types';
import { ROLE_COLORS } from '../types';

// Re-export GraphSettings so App.tsx can import from one place
export interface GraphSettings {
  minNodeRadius: number;
  linkDistance: number;
  linkStrength: number;
  chargeStrength: number;
  showLabels: boolean;
  threeDLinkOpacity: number;
  threeDLabelSize: number;
  orbit: boolean;
  geoInfluence: number;
  animatePacketFlow: boolean;
  packetHighlightDurationMs: number;
  packetHighlightMode: 'fixed' | 'packetDuration';
  packetObservationWindowMs: number;
}

interface Props {
  nodes: NodeData[];
  edges: EdgeData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  settings: GraphSettings;
  focusKey?: number;
  focusNodeId?: string | null;
  geoCenter?: { lat: number; lng: number } | null;
  inFlightPackets?: InFlightPacket[];
}

function nodeColor(node: NodeData): string {
  if (node.is_observer) return '#22d3ee';
  return ROLE_COLORS[node.device_role] ?? ROLE_COLORS[0];
}

function canonicalKey(a: string, b: string): string {
  return a < b ? `${a}<>${b}` : `${b}<>${a}`;
}

/** Holds a node as both a SimNode (mesh/label data) and a SimNode3D (D3 position data). */
interface GraphSimNode extends SimNode, SimNode3D {
  id: string;
}

interface GraphSimLink extends SimLink3D<GraphSimNode> {
  source: GraphSimNode | string;
  target: GraphSimNode | string;
}

export function NetworkGraph3DCustom({
  nodes,
  edges,
  selectedId,
  onSelect,
  settings,
  focusKey,
  focusNodeId,
  geoCenter,
  inFlightPackets = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MeshRenderer | null>(null);

  // Kept as refs so D3 tick closures always read current values without
  // causing the sim setup effect to re-run.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  /** Current packet-path node ids — used by the inFlightPackets effect. */
  const activePacketHitsRef = useRef(new Set<string>());

  // Stable ref for onSelect — so the renderer callback never goes stale when
  // App.tsx re-renders (e.g. isMobileViewport changes and recreates handleSelect).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Mutable D3 sim node/link arrays — D3 writes x/y/z/vx/vy/vz into these objects.
  const simNodesRef = useRef<GraphSimNode[]>([]);
  const simLinksRef = useRef<GraphSimLink[]>([]);

  // Structural fingerprints: only reheat + rebuild topology when these change,
  // not on every packet-count update that comes through on existing nodes.
  const nodeIdsFpRef = useRef('');
  const edgeIdsFpRef = useRef('');

  // Display fingerprint: tracks name/role/observer — changes here need refreshMetadata.
  // Pure packet-count / last_seen updates don't change this and skip the renderer.
  const nodeDisplayFpRef = useRef('');

  // The D3 simulation instance, created once per mount.
  const simRef = useRef<Simulation3D<GraphSimNode> | null>(null);

  // ---- Resize observer — calls renderer.setSize() directly, no React state ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => {
      rendererRef.current?.setSize(container.clientWidth, container.clientHeight);
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // ---- Create renderer + D3 sim on mount ----
  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current;

    const renderer = new MeshRenderer(canvas, (id) => onSelectRef.current(id));
    rendererRef.current = renderer;

    // Set initial size from the container's current dimensions
    if (container) {
      renderer.setSize(container.clientWidth, container.clientHeight);
    }

    // ---- Create 3D force simulation ----
    const sim = forceSimulation<GraphSimNode>([], 3)
      .alphaDecay(0.05)
      .velocityDecay(0.3)
      .force('charge', forceManyBody<GraphSimNode>().strength(settingsRef.current.chargeStrength))
      .force('link',
        forceLink<GraphSimNode, GraphSimLink>([])
          .id((d) => d.id)
          .distance(settingsRef.current.linkDistance)
          .strength(settingsRef.current.linkStrength),
      )
      .force('center', forceCenter<GraphSimNode>(0, 0, 0))
      .on('tick', () => {
        rendererRef.current?.updatePositions(simNodesRef.current);
      });

    simRef.current = sim;

    return () => {
      sim.stop();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Topology: rebuild sim nodes/links when graph data changes ----
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;

    const s = settingsRef.current;
    const geoMap = projectGeo(nodes, 400, geoCenter ?? undefined);

    // Merge incoming NodeData with existing sim nodes to preserve D3 positions.
    const existingMap = new Map<string, GraphSimNode>();
    for (const sn of simNodesRef.current) existingMap.set(sn.id, sn);

    const newSimNodes: GraphSimNode[] = nodes.map((n) => {
      const label = n.name ?? n.hash.toUpperCase();
      const color = nodeColor(n);
      const radius = s.minNodeRadius;

      const existing = existingMap.get(n.hash);
      if (existing) {
        // Update display fields; D3 keeps mutating x/y/z on this same object
        existing.label = label;
        existing.color = color;
        existing.radius = radius;
        return existing;
      }
      // New node: seed position from geo data if available
      const geo = geoMap.get(n.hash);
      return {
        id: n.hash,
        label,
        color,
        radius,
        ...(geo ? { x: geo.x, y: geo.y } : {}),
      } as GraphSimNode;
    });

    // Deduplicate bidirectional edges
    const nodeSet = new Set(newSimNodes.map((n) => n.id));
    const linkMap = new Map<string, GraphSimLink>();
    for (const edge of edges) {
      if (!nodeSet.has(edge.from_hash) || !nodeSet.has(edge.to_hash)) continue;
      const key = canonicalKey(edge.from_hash, edge.to_hash);
      if (!linkMap.has(key)) {
        linkMap.set(key, { source: edge.from_hash, target: edge.to_hash });
      }
    }
    const newSimLinks = [...linkMap.values()];

    simNodesRef.current = newSimNodes;
    simLinksRef.current = newSimLinks;

    // Compute structural fingerprints (sorted node ids + sorted edge canonical keys).
    // O(n log n) but only runs on prop changes — not on every packet.
    const nodeFp = nodes.map(n => n.hash).sort().join(',');
    const edgeFp = [...linkMap.keys()].sort().join(',');
    const prevNodeFp = nodeIdsFpRef.current;
    const structureChanged = nodeFp !== prevNodeFp || edgeFp !== edgeIdsFpRef.current;
    nodeIdsFpRef.current = nodeFp;
    edgeIdsFpRef.current = edgeFp;

    // Display fingerprint: only name, role, and observer flag affect what the mesh
    // looks like. packet_count / last_seen changes don't need a renderer update.
    const displayFp = nodes.map(n => `${n.hash}:${n.name ?? ''}:${n.device_role}:${n.is_observer}`).sort().join('|');
    const displayChanged = displayFp !== nodeDisplayFpRef.current;
    nodeDisplayFpRef.current = displayFp;

    if (structureChanged) {
      // Feed updated structure into D3
      sim.nodes(newSimNodes);
      (sim.force('link') as ForceLink3D<GraphSimNode, GraphSimLink>).links(newSimLinks);

      // Degree-weighted charge: hub nodes repel harder than leaf nodes
      const degreeMap = new Map<string, number>();
      for (const link of newSimLinks) {
        const s_ = typeof link.source === 'string' ? link.source : (link.source as GraphSimNode).id;
        const t_ = typeof link.target === 'string' ? link.target : (link.target as GraphSimNode).id;
        degreeMap.set(s_, (degreeMap.get(s_) ?? 0) + 1);
        degreeMap.set(t_, (degreeMap.get(t_) ?? 0) + 1);
      }
      const maxDeg = Math.max(1, ...degreeMap.values());
      const baseCharge = s.chargeStrength;
      (sim.force('charge') as ReturnType<typeof forceManyBody>).strength(
        (node: SimNode3D) => {
          const deg = degreeMap.get((node as GraphSimNode).id) ?? 0;
          return baseCharge * (1 + 2 * (deg / maxDeg)) / 3;
        },
      );

      // On first load (graph was empty before) run warmup ticks synchronously so
      // nodes appear already settled rather than visibly scattering from the origin.
      // setTopology() reads n.x/y/z after tick() to seed the initial positions.
      if (prevNodeFp === '') {
        sim.tick(100);
        sim.restart(); // continue cooling down asynchronously
      } else {
        // New nodes need more energy to find a stable position; new edges between
        // already-known nodes only need a gentle nudge so they don't cause visible
        // twitching across the whole graph.
        const hasNewNodes = nodeFp !== prevNodeFp;
        const reheatAlpha = hasNewNodes ? 0.2 : 0.05;
        sim.alpha(Math.max(sim.alpha(), reheatAlpha)).restart();
      }

      // Full topology rebuild in renderer (new index maps, edge geometry, labels).
      // Called AFTER tick() so initial positions are the post-warmup positions.
      rendererRef.current?.setTopology(newSimNodes, newSimLinks);
      rendererRef.current?.updateColors(newSimNodes, selectedIdRef.current);
    } else if (displayChanged) {
      // A node was renamed or changed role — update labels and base sphere colours,
      // then re-apply the selection overlay. Packet hits on edges are unaffected.
      rendererRef.current?.refreshMetadata(newSimNodes);
      rendererRef.current?.updateColors(newSimNodes, selectedIdRef.current);
    }
    // else: only packet_count / last_seen changed — nothing visible to redraw.
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Geo forces ----
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const s = settingsRef.current;
    if (s.geoInfluence > 0) {
      const geoMap = projectGeo(nodes, 400, geoCenter ?? undefined);
      if (geoMap.size > 0) {
        sim.force('geoX',
          forceX<GraphSimNode>((n) => geoMap.get(n.id)?.x ?? 0)
            .strength((n) => geoMap.has(n.id) ? s.geoInfluence : 0),
        );
        sim.force('geoY',
          forceY<GraphSimNode>((n) => geoMap.get(n.id)?.y ?? 0)
            .strength((n) => geoMap.has(n.id) ? s.geoInfluence : 0),
        );
        sim.alpha(Math.max(sim.alpha(), 0.2)).restart();
        return;
      }
    }
    sim.force('geoX', null);
    sim.force('geoY', null);
  }, [settings.geoInfluence, geoCenter, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Force parameters (link distance / strength / charge) ----
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    (sim.force('link') as ForceLink3D<GraphSimNode, GraphSimLink> | undefined)
      ?.distance(settings.linkDistance)
       .strength(settings.linkStrength);
    sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
  }, [settings.linkDistance, settings.linkStrength]);

  useEffect(() => {
    // chargeStrength — rebuild degree-weighted charge
    const sim = simRef.current;
    if (!sim) return;
    const degreeMap = new Map<string, number>();
    for (const link of simLinksRef.current) {
      const s_ = typeof link.source === 'string' ? link.source : (link.source as GraphSimNode).id;
      const t_ = typeof link.target === 'string' ? link.target : (link.target as GraphSimNode).id;
      degreeMap.set(s_, (degreeMap.get(s_) ?? 0) + 1);
      degreeMap.set(t_, (degreeMap.get(t_) ?? 0) + 1);
    }
    const maxDeg = Math.max(1, ...degreeMap.values());
    const base = settings.chargeStrength;
    (sim.force('charge') as ReturnType<typeof forceManyBody>).strength(
      (node: SimNode3D) => base * (1 + 2 * ((degreeMap.get((node as GraphSimNode).id) ?? 0) / maxDeg)) / 3,
    );
    sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
  }, [settings.chargeStrength]);

  // ---- Node radius change: update sim node radii and re-render ----
  useEffect(() => {
    for (const sn of simNodesRef.current) {
      sn.radius = settings.minNodeRadius;
    }
    const r = rendererRef.current;
    if (!r) return;
    r.updatePositions(simNodesRef.current);
    r.updateColors(simNodesRef.current, selectedIdRef.current);
  }, [settings.minNodeRadius]);

  // ---- Link opacity ----
  useEffect(() => {
    rendererRef.current?.setLinkOpacity(settings.threeDLinkOpacity);
  }, [settings.threeDLinkOpacity]);

  // ---- Labels ----
  useEffect(() => {
    rendererRef.current?.setLabelsVisible(settings.showLabels);
  }, [settings.showLabels]);

  useEffect(() => {
    rendererRef.current?.setLabelSize(settings.threeDLabelSize);
  }, [settings.threeDLabelSize]);

  // ---- Colour updates: selection ----
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.updateColors(simNodesRef.current, selectedId);
  }, [selectedId]);

  // ---- Packet-path edge highlights ----
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !settings.animatePacketFlow) {
      if (activePacketHitsRef.current.size > 0) {
        activePacketHitsRef.current = new Set();
        r?.setPacketHits(activePacketHitsRef.current);
      }
      return;
    }
    const now = Date.now();
    const next = new Set<string>();
    for (const pkt of inFlightPackets) {
      if (pkt.finishedAt < now || pkt.startedAt > now) continue;
      for (const h of pkt.highlightedNodes) next.add(h);
    }
    const prev = activePacketHitsRef.current;
    let changed = next.size !== prev.size;
    if (!changed) {
      for (const h of next) {
        if (!prev.has(h)) { changed = true; break; }
      }
    }
    if (!changed) return;
    activePacketHitsRef.current = next;
    r.setPacketHits(next);
  }, [inFlightPackets, settings.animatePacketFlow]);

  // ---- Orbit mode ----
  useEffect(() => {
    rendererRef.current?.resetOrbitAngle();
  }, [selectedId]);

  useEffect(() => {
    rendererRef.current?.setOrbitMode(settings.orbit, selectedIdRef.current);
  }, [settings.orbit]);

  // When selection changes during orbit, update the orbit focus target
  useEffect(() => {
    if (settings.orbit) {
      rendererRef.current?.setOrbitMode(true, selectedId);
    }
  }, [selectedId, settings.orbit]);

  // ---- Camera fly-to on node search / focus ----
  useEffect(() => {
    if (!focusNodeId || !focusKey) return;
    const r = rendererRef.current;
    if (!r) return;
    // Try to get the position from simNodes (D3 may have it already)
    const pos = r.getNodePosition(focusNodeId);
    if (pos) {
      r.flyTo(pos.x, pos.y, pos.z);
    }
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
}
