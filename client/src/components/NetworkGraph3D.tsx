import { useMemo, useRef, useState, useEffect } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import type { EdgeData, NodeData } from '../types';
import { ROLE_COLORS } from '../types';
import type { GraphSettings } from './NetworkGraph';

interface Props {
  nodes: NodeData[];
  edges: EdgeData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  settings: GraphSettings;
}

interface GraphNode extends NodeData {
  id: string;
  color: string;
  val: number;
}

interface GraphLink {
  source: string;
  target: string;
}

function nodeColor(node: NodeData): string {
  return ROLE_COLORS[node.device_role] ?? ROLE_COLORS[0];
}

export function NetworkGraph3D({ nodes, edges, selectedId, onSelect, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef(new Map<string, GraphNode>());
  const linkMapRef = useRef(new Map<string, GraphLink>());
  // SpriteText cache: avoids recreating 200+ Three.js objects on every data update.
  const spriteMapRef = useRef(new Map<string, SpriteText>());
  const [size, setSize] = useState({ width: 0, height: 0 });

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


  const graphData = useMemo(() => {
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
        nextNodeMap.set(node.hash, {
          ...node,
          id: node.hash,
          color: nodeColor(node),
          val: settings.minNodeRadius / 2,
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

    for (const edge of edges) {
      if (!nodeSet.has(edge.from_hash) || !nodeSet.has(edge.to_hash)) {
        continue;
      }

      const key = `${edge.from_hash}->${edge.to_hash}`;
      const existing = linkMapRef.current.get(key);
      if (existing) {
        nextLinkMap.set(key, existing);
      } else {
        nextLinkMap.set(key, {
          source: edge.from_hash,
          target: edge.to_hash,
        });
      }
    }

    linkMapRef.current = nextLinkMap;

    return {
      nodes: [...nextNodeMap.values()],
      links: [...nextLinkMap.values()],
    };
  }, [nodes, edges, settings.minNodeRadius]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
      {size.width > 0 && size.height > 0 && (
        <ForceGraph3D
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="#030712"
          nodeLabel={(node) => {
            const graphNode = node as GraphNode;
            return `${graphNode.name ?? graphNode.hash.toUpperCase()}\n${graphNode.hash.toUpperCase()}`;
          }}
          nodeColor={(node) => {
            const graphNode = node as GraphNode;
            return graphNode.hash === selectedId ? '#fbbf24' : graphNode.color;
          }}
          nodeRelSize={3}
          linkWidth={1.5}
          linkColor={() => '#2563eb'}
          linkOpacity={settings.threeDLinkOpacity}
          onNodeClick={(node) => {
            const graphNode = node as GraphNode;
            onSelect(graphNode.hash);
          }}
          onBackgroundClick={() => onSelect(null)}
          // nodeThreeObjectExtend keeps the default coloured sphere and adds the
          // sprite as a child above it, rather than replacing the sphere entirely.
          nodeThreeObjectExtend={settings.showLabels}
          nodeThreeObject={settings.showLabels ? (node: object) => {
            const graphNode = node as GraphNode;
            const label = graphNode.name ?? graphNode.hash.toUpperCase();
            // Reuse cached sprite; only recreate if text or size changed.
            let sprite = spriteMapRef.current.get(graphNode.hash);
            if (!sprite || sprite.text !== label || sprite.textHeight !== settings.threeDLabelSize) {
              sprite = new SpriteText(label);
              sprite.color = '#9ca3af';
              sprite.textHeight = settings.threeDLabelSize;
              spriteMapRef.current.set(graphNode.hash, sprite);
            }
            // Position label above the sphere. Sphere radius ≈ nodeRelSize * ∛val = 3 * ∛(minNodeRadius/2).
            sprite.position.y = 3 * Math.cbrt(settings.minNodeRadius / 2) + 3;
            return sprite;
          } : undefined}
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
