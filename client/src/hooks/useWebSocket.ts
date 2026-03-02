import { useEffect, useRef, useState, useCallback } from 'react';
import type { NodeData, EdgeData, StatsData, WsMessage, PacketEvent, DebugLogEntry } from '../types';

interface GraphState {
  nodes: NodeData[];
  edges: EdgeData[];
}

interface UseWebSocketResult {
  nodes: NodeData[];
  edges: EdgeData[];
  stats: StatsData;
  recentPackets: PacketEvent[];
  debugLogs: DebugLogEntry[];
  connected: boolean;
  mqttStatus: 'unknown' | 'connected' | 'disconnected';
}

const DEFAULT_STATS: StatsData = {
  nodeCount: 0,
  edgeCount: 0,
  advertCount: 0,
  namedNodeCount: 0,
};

function mergeNode(nodes: NodeData[], incoming: NodeData): NodeData[] {
  const idx = nodes.findIndex(n => n.hash === incoming.hash);
  if (idx === -1) return [...nodes, incoming];
  const updated = [...nodes];
  updated[idx] = incoming;
  return updated;
}

function mergeEdge(edges: EdgeData[], incoming: EdgeData): EdgeData[] {
  const idx = edges.findIndex(
    e => e.from_hash === incoming.from_hash && e.to_hash === incoming.to_hash
  );
  if (idx === -1) return [...edges, incoming];
  const updated = [...edges];
  updated[idx] = incoming;
  return updated;
}

export function useWebSocket(url: string): UseWebSocketResult {
  const [graph, setGraph] = useState<GraphState>({ nodes: [], edges: [] });
  const [stats, setStats] = useState<StatsData>(DEFAULT_STATS);
  const [recentPackets, setRecentPackets] = useState<PacketEvent[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data as string) as WsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'init':
          setGraph({ nodes: msg.nodes, edges: msg.edges });
          setStats(msg.stats);
          break;

        case 'node':
          setGraph(prev => ({ ...prev, nodes: mergeNode(prev.nodes, msg.node) }));
          break;

        case 'edge':
          setGraph(prev => ({ ...prev, edges: mergeEdge(prev.edges, msg.edge) }));
          break;

        case 'stats':
          setStats(msg.stats);
          break;

        case 'packet':
          setRecentPackets(prev => {
            const entry: PacketEvent = {
              packetType: msg.packetType,
              hash: msg.hash,
              pathLen: msg.pathLen,
              receivedAt: Date.now(),
            };
            return [entry, ...prev].slice(0, 50);
          });
          break;

        case 'debug':
          setDebugLogs(prev => {
            const entry: DebugLogEntry = { level: msg.level, message: msg.message, ts: msg.ts };
            return [entry, ...prev].slice(0, 200);
          });
          break;
      }
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    nodes: graph.nodes,
    edges: graph.edges,
    stats,
    recentPackets,
    debugLogs,
    connected,
    mqttStatus: 'unknown',
  };
}
