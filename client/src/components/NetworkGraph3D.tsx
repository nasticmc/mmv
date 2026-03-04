import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as d3 from 'd3';
import type { EdgeData, NodeData, PacketEvent } from '../types';
import { ROLE_COLORS } from '../types';
import type { GraphSettings } from './NetworkGraph';
import { projectGeo } from './NetworkGraph';

interface Props {
  nodes: NodeData[];
  edges: EdgeData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  settings: GraphSettings;
  /** Bumping this number triggers a camera fly to focusNodeId. */
  focusKey?: number;
  focusNodeId?: string | null;
  recentPackets: PacketEvent[];
  packetAnimationEnabled: boolean;
  geoCenter?: { lat: number; lng: number } | null;
}

interface GraphNode extends NodeData {
  id: string;
  color: string;
  val: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

function nodeColor(node: NodeData): string {
  return ROLE_COLORS[node.device_role] ?? ROLE_COLORS[0];
}

function linkEndId(end: string | number | GraphNode | object): string {
  if (end && typeof end === 'object') return (end as GraphNode).id;
  return String(end);
}

// How long (ms) to wait between pushing graph topology updates to the renderer.
// This prevents the D3 simulation from reheating on every incoming packet,
// which is especially important on mobile where reheats cause visible jitter.
const MESH_REFRESH_MS = 30_000;

export function NetworkGraph3D({
  nodes, edges, selectedId, onSelect, settings, focusKey, focusNodeId, recentPackets, packetAnimationEnabled, geoCenter,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const nodeMapRef = useRef(new Map<string, GraphNode>());
  const linkMapRef = useRef(new Map<string, GraphLink>());
  // SpriteText cache: avoids recreating 200+ Three.js objects on every data update.
  const spriteMapRef = useRef(new Map<string, SpriteText>());
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Kept current in render so closures never go stale.
  const selectedIdRef = useRef(selectedId);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Orbit animation state
  const orbitRafRef = useRef<number | null>(null);
  const orbitingRef = useRef(false);
  const orbitAngleRef = useRef<number | null>(null);
  const packetCursorRef = useRef(-1);

  useEffect(() => {
    if (!packetAnimationEnabled || !settings.showPacketAnimation) return;
    const fg = fgRef.current;
    if (!fg) return;
    for (const packet of [...recentPackets].reverse()) {
      if (packet.id <= packetCursorRef.current) continue;
      packetCursorRef.current = packet.id;
      const hops = packet.path;
      if (hops.length < 2) continue;
      const segmentMs = Math.max(80, Math.min((packet.duration ?? (hops.length - 1) * 250) / (hops.length - 1), 2000));
      hops.slice(0, -1).forEach((from, i) => {
        const to = hops[i + 1];
        setTimeout(() => {
          const link = (fg.graphData().links as GraphLink[]).find((l) => {
            const s = linkEndId(l.source);
            const t = linkEndId(l.target);
            return (s === from && t === to) || (s === to && t === from);
          });
          if (link) fg.emitParticle(link);
        }, i * segmentMs);
      });
    }
  }, [recentPackets, packetAnimationEnabled, settings.showPacketAnimation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      setSize({ width: container.clientWidth, height: container.clientHeight });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Build graph objects, preserving existing node positions so the layout
  // doesn't jump when new data arrives between 30-second display flushes.
  const graphData = useMemo(() => {
    const geoMap = projectGeo(nodes, 400, geoCenter ?? undefined);
    const nextNodeMap = new Map<string, GraphNode>();

    for (const node of nodes) {
      const existing = nodeMapRef.current.get(node.hash);
      if (existing) {
        Object.assign(existing, node, {
          id: node.hash,
          color: nodeColor(node),
          val: settings.minNodeRadius / 2,
        });
        nextNodeMap.set(node.hash, existing);
      } else {
        const geo = geoMap.get(node.hash);
        nextNodeMap.set(node.hash, {
          ...node,
          id: node.hash,
          color: nodeColor(node),
          val: settings.minNodeRadius / 2,
          ...(geo && { x: geo.x, y: geo.y }),
        });
      }
    }

    nodeMapRef.current = nextNodeMap;

    // Prune stale sprite cache entries so we don't hold Three.js objects for gone nodes.
    for (const h of spriteMapRef.current.keys()) {
      if (!nextNodeMap.has(h)) spriteMapRef.current.delete(h);
    }

    const nodeSet = new Set(nextNodeMap.keys());
    const nextLinkMap = new Map<string, GraphLink>();

    // Deduplicate bidirectional edges: if A→B and B→A both exist, render one link.
    for (const edge of edges) {
      if (!nodeSet.has(edge.from_hash) || !nodeSet.has(edge.to_hash)) continue;
      const canonical = [edge.from_hash, edge.to_hash].sort().join('<>');
      if (nextLinkMap.has(canonical)) continue;
      const existing = linkMapRef.current.get(canonical);
      nextLinkMap.set(canonical, existing ?? { source: edge.from_hash, target: edge.to_hash });
    }

    linkMapRef.current = nextLinkMap;

    return {
      nodes: [...nextNodeMap.values()],
      links: [...nextLinkMap.values()],
    };
  }, [nodes, edges, settings.minNodeRadius]);

  // ---------------------------------------------------------------------------
  // Throttled display data: we buffer the latest computed graphData but only
  // push it to the ForceGraph3D renderer every MESH_REFRESH_MS. This stops the
  // D3 simulation from reheating on every incoming WebSocket packet, preventing
  // the constant jitter on mobile.
  // ---------------------------------------------------------------------------
  const pendingRef = useRef(graphData);
  pendingRef.current = graphData;

  const [displayData, setDisplayData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>(
    () => ({ nodes: [], links: [] })
  );

  // Flush immediately when the first batch of nodes arrives.
  const hasNodes = graphData.nodes.length > 0;
  useEffect(() => {
    if (hasNodes) {
      setDisplayData(pendingRef.current);
    }
  }, [hasNodes]);

  // After the initial flush, refresh the display every MESH_REFRESH_MS.
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayData({ ...pendingRef.current });
    }, MESH_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Keep orbit animation ref pointing at the throttled display data so the
  // camera always orbits the visible layout, not the pending one.
  const graphDataRef = useRef(displayData);
  graphDataRef.current = displayData;

  // Reset orbit angle when selection changes so the camera re-initialises from
  // its current position instead of jumping to a stale angle.
  if (selectedIdRef.current !== selectedId) {
    orbitAngleRef.current = null;
  }
  selectedIdRef.current = selectedId;

  // Degree-weighted repulsion: high-degree hub nodes repel harder, pushing them
  // outward to form the skeleton while leaf nodes stay near their hub.
  // Depends on displayData.links so it only re-runs when the renderer actually
  // receives new topology (every 30 s), not on every incoming packet.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const degreeMap = new Map<string, number>();
    for (const link of displayData.links) {
      const s = linkEndId(link.source);
      const t = linkEndId(link.target);
      degreeMap.set(s, (degreeMap.get(s) ?? 0) + 1);
      degreeMap.set(t, (degreeMap.get(t) ?? 0) + 1);
    }
    const maxDegree = Math.max(1, ...degreeMap.values());
    fg.d3Force('charge')?.strength((node: { id: string }) => {
      const degree = degreeMap.get(node.id) ?? 0;
      return settings.chargeStrength * (1 + 2 * (degree / maxDegree)) / 3;
    });
    fg.d3ReheatSimulation();
  }, [displayData.links, settings.chargeStrength]);

  // Wire link distance and strength into the 3D force simulation.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('link')?.distance(settings.linkDistance).strength(settings.linkStrength);
    fg.d3ReheatSimulation();
  }, [settings.linkDistance, settings.linkStrength]);

  // Geo-attraction forces: runs when the throttled display topology refreshes or
  // when the user adjusts geo influence. Nodes without location data get strength 0.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    if (settings.geoInfluence > 0) {
      const geoMap = projectGeo(displayData.nodes, 400, geoCenter ?? undefined);
      if (geoMap.size > 0) {
        fg.d3Force('geoX',
          d3.forceX((n: any) => geoMap.get(n.id)?.x ?? 0)
            .strength((n: any) => (geoMap.has(n.id) ? settings.geoInfluence : 0))
        );
        fg.d3Force('geoY',
          d3.forceY((n: any) => geoMap.get(n.id)?.y ?? 0)
            .strength((n: any) => (geoMap.has(n.id) ? settings.geoInfluence : 0))
        );
        fg.d3ReheatSimulation();
        return;
      }
    }

    fg.d3Force('geoX', null);
    fg.d3Force('geoY', null);
  }, [displayData.nodes, settings.geoInfluence, geoCenter]);

  // Fly camera to a focused node when focusKey changes.
  useEffect(() => {
    if (!focusNodeId || !focusKey) return;
    const fg = fgRef.current;
    if (!fg) return;
    const node = nodeMapRef.current.get(focusNodeId) as any;
    if (!node) return;
    const { x = 0, y = 0, z = 0 } = node;
    fg.cameraPosition(
      { x, y: y + 50, z: z + 200 },
      { x, y, z },
      1000,
    );
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // When selectedId changes, ask the renderer to re-evaluate node/link colours
  // using the stable callbacks below. This avoids a full scene rebuild that
  // would cause nodes to vanish and reappear.
  useEffect(() => {
    fgRef.current?.refresh();
  }, [selectedId]);

  // ---------------------------------------------------------------------------
  // Stable render callbacks — these close over refs rather than prop values so
  // their function identity never changes. ForceGraph3D treats new function
  // references as "everything changed" and rebuilds Three.js objects for every
  // node, which is what causes the disappear/repopulate flash on search.
  // ---------------------------------------------------------------------------
  const nodeColorCb = useCallback((node: object) => {
    const graphNode = node as GraphNode;
    return graphNode.hash === selectedIdRef.current ? '#fbbf24' : graphNode.color;
  }, []);

  const nodeThreeObjectCb = useCallback((node: object) => {
    const graphNode = node as GraphNode;
    const s = settingsRef.current;
    const label = graphNode.name ?? graphNode.hash.toUpperCase();
    // Reuse cached sprite; only recreate if text or size changed.
    let sprite = spriteMapRef.current.get(graphNode.hash);
    if (!sprite || sprite.text !== label || sprite.textHeight !== s.threeDLabelSize) {
      sprite = new SpriteText(label);
      sprite.color = '#ffffff';
      sprite.backgroundColor = 'rgba(0,0,0,0.55)';
      sprite.padding = 1.5;
      sprite.borderRadius = 2;
      sprite.textHeight = s.threeDLabelSize;
      spriteMapRef.current.set(graphNode.hash, sprite);
    }
    // Position label above the sphere. Sphere radius ≈ nodeRelSize * ∛val = 3 * ∛(minNodeRadius/2).
    // Cast needed because three-spritetext's typings don't expose inherited Object3D.position.
    (sprite as unknown as { position: { y: number } }).position.y = 3 * Math.cbrt(s.minNodeRadius / 2) + 3;
    return sprite;
  }, []); // stable — reads live values from settingsRef

  const linkWidthCb = useCallback((link: object) => {
    const sel = selectedIdRef.current;
    if (!sel) return 1.5;
    const s = linkEndId((link as GraphLink).source);
    const t = linkEndId((link as GraphLink).target);
    return s === sel || t === sel ? 3.5 : 1;
  }, []);

  const linkColorCb = useCallback((link: object) => {
    const sel = selectedIdRef.current;
    if (!sel) return '#2563eb';
    const s = linkEndId((link as GraphLink).source);
    const t = linkEndId((link as GraphLink).target);
    return s === sel || t === sel ? '#fbbf24' : '#1e3558';
  }, []);

  // Orbit: slowly rotate camera around the centroid of all nodes.
  useEffect(() => {
    if (!settings.orbit) {
      orbitingRef.current = false;
      orbitAngleRef.current = null;
      if (orbitRafRef.current !== null) {
        cancelAnimationFrame(orbitRafRef.current);
        orbitRafRef.current = null;
      }
      return;
    }

    orbitingRef.current = true;

    const animate = () => {
      if (!orbitingRef.current) return;

      const fg = fgRef.current;
      const gd = graphDataRef.current;

      if (fg && gd.nodes.length > 0) {
        const ns = gd.nodes as any[];
        // When a node is selected orbit around it; otherwise use the cluster centroid.
        const sel = selectedIdRef.current
          ? (ns.find((n: any) => n.id === selectedIdRef.current) ?? null)
          : null;
        const cx = sel ? (sel.x ?? 0) : ns.reduce((s: number, n: any) => s + (n.x ?? 0), 0) / ns.length;
        const cy = sel ? (sel.y ?? 0) : ns.reduce((s: number, n: any) => s + (n.y ?? 0), 0) / ns.length;
        const cz = sel ? (sel.z ?? 0) : ns.reduce((s: number, n: any) => s + (n.z ?? 0), 0) / ns.length;

        const cam = fg.camera();
        const dx = cam.position.x - cx;
        const dz = cam.position.z - cz;

        // Initialise angle from the camera's current position to avoid a jump.
        if (orbitAngleRef.current === null) {
          orbitAngleRef.current = Math.atan2(dx, dz);
        }

        const radius = Math.sqrt(dx * dx + dz * dz) || 400;
        orbitAngleRef.current += 0.004; // ~0.23° per frame at 60 fps
        const angle = orbitAngleRef.current;

        fg.cameraPosition(
          { x: cx + radius * Math.sin(angle), y: cam.position.y, z: cz + radius * Math.cos(angle) },
          { x: cx, y: cy, z: cz },
          0,
        );
      }

      orbitRafRef.current = requestAnimationFrame(animate);
    };

    orbitRafRef.current = requestAnimationFrame(animate);

    return () => {
      orbitingRef.current = false;
      orbitAngleRef.current = null;
      if (orbitRafRef.current !== null) {
        cancelAnimationFrame(orbitRafRef.current);
        orbitRafRef.current = null;
      }
    };
  }, [settings.orbit]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
      {size.width > 0 && size.height > 0 && (
        <ForceGraph3D
          ref={fgRef}
          graphData={displayData}
          width={size.width}
          height={size.height}
          backgroundColor="#030712"
          nodeLabel={(node) => {
            const graphNode = node as GraphNode;
            return `${graphNode.name ?? graphNode.hash.toUpperCase()}\n${graphNode.hash.toUpperCase()}`;
          }}
          nodeColor={nodeColorCb}
          nodeRelSize={3}
          linkWidth={linkWidthCb}
          linkColor={linkColorCb}
          linkOpacity={settings.threeDLinkOpacity}
          onNodeClick={(node) => {
            // Always select the clicked node. If it was already selected the
            // parent will re-open the panel rather than deselecting.
            onSelect((node as GraphNode).hash);
          }}
          onBackgroundClick={() => onSelect(null)}
          // nodeThreeObjectExtend keeps the default coloured sphere and adds the
          // sprite as a child above it, rather than replacing the sphere entirely.
          nodeThreeObjectExtend={settings.showLabels}
          nodeThreeObject={settings.showLabels ? nodeThreeObjectCb : undefined}
          // warmupTicks runs the simulation silently before first render so the graph
          // appears already settled rather than animating from a random layout on mobile.
          warmupTicks={100}
          cooldownTicks={50}
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.3}
        />
      )}
    </div>
  );
}
