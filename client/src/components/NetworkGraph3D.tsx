import { useEffect, useMemo, useRef, useState } from 'react';
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
          nodeThreeObject={(node: object) => {
            if (!settings.showLabels) return undefined;
            const graphNode = node as GraphNode;
            const sprite = new SpriteText(graphNode.name ?? graphNode.hash.toUpperCase());
            sprite.color = '#9ca3af';
            sprite.textHeight = settings.threeDLabelSize;
            return sprite;
          }}
          cooldownTicks={150}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.3}
        />
      )}
    </div>
  );
}
