import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type LinkObject, type NodeObject } from 'react-force-graph-3d';
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
  width: number;
}

function linkNodeId(node: string | number | NodeObject<GraphNode>): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  return String(node.id ?? '');
}

function nodeColor(node: NodeData): string {
  return ROLE_COLORS[node.device_role] ?? ROLE_COLORS[0];
}

function edgeWidth(e: EdgeData): number {
  return Math.max(0.5, Math.min(e.packet_count / 12, 3));
}

export function NetworkGraph3D({ nodes, edges, selectedId, onSelect, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
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
    const graphNodes: GraphNode[] = nodes.map((node) => ({
      ...node,
      id: node.hash,
      color: nodeColor(node),
      val: Math.max(
        settings.minNodeRadius / 2,
        Math.min(settings.maxNodeRadius / 2, settings.minNodeRadius / 2 + node.packet_count / 4)
      ),
    }));

    const nodeSet = new Set(graphNodes.map((node) => node.hash));
    const graphLinks: GraphLink[] = edges
      .filter((edge) => nodeSet.has(edge.from_hash) && nodeSet.has(edge.to_hash))
      .map((edge) => ({
        source: edge.from_hash,
        target: edge.to_hash,
        width: edgeWidth(edge),
      }));

    return { nodes: graphNodes, links: graphLinks };
  }, [nodes, edges, settings.maxNodeRadius, settings.minNodeRadius]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
      {size.width > 0 && size.height > 0 && (
        <ForceGraph3D
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="#030712"
          nodeLabel={(node: NodeObject<GraphNode>) => {
            const graphNode = node as GraphNode;
            return `${graphNode.name ?? graphNode.hash.toUpperCase()}\n${graphNode.hash.toUpperCase()}`;
          }}
          nodeColor={(node: NodeObject<GraphNode>) => {
            const graphNode = node as GraphNode;
            if (!selectedId) return graphNode.color;
            if (graphNode.hash === selectedId) return '#fbbf24';
            const connected = edges.some((e) =>
              (e.from_hash === selectedId && e.to_hash === graphNode.hash) ||
              (e.to_hash === selectedId && e.from_hash === graphNode.hash)
            );
            return connected ? graphNode.color : '#374151';
          }}
          nodeRelSize={3}
          linkWidth={(link: LinkObject<GraphNode, GraphLink>) => {
            if (!selectedId) return link.width;
            const sourceId = linkNodeId(link.source ?? '');
            const targetId = linkNodeId(link.target ?? '');
            return sourceId === selectedId || targetId === selectedId ? link.width + 1 : 0.4;
          }}
          linkColor={(link: LinkObject<GraphNode, GraphLink>) => {
            if (!selectedId) return '#2563eb';
            const sourceId = linkNodeId(link.source ?? '');
            const targetId = linkNodeId(link.target ?? '');
            return sourceId === selectedId || targetId === selectedId ? '#fbbf24' : '#1d4ed8';
          }}
          linkOpacity={0.55}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(node: NodeObject<GraphNode>) => {
            const graphNode = node as GraphNode;
            onSelect(graphNode.hash);
          }}
          onBackgroundClick={() => onSelect(null)}
          nodeThreeObject={(node: object) => {
            if (!settings.showLabels) return undefined;
            const graphNode = node as GraphNode;
            const sprite = new SpriteText(graphNode.name ?? graphNode.hash.toUpperCase());
            sprite.color = '#9ca3af';
            sprite.textHeight = 5;
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
