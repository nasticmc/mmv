import { useEffect, useRef, useState, useCallback } from 'react';
import type { NodeData, EdgeData, StatsData, WsMessage, PacketEvent, DebugLogEntry, InFlightPacket, InFlightHop } from '../types';

interface GraphState {
  nodes: NodeData[];
  edges: EdgeData[];
}

interface UseWebSocketResult {
  nodes: NodeData[];
  edges: EdgeData[];
  stats: StatsData;
  recentPackets: PacketEvent[];
  inFlightPackets: InFlightPacket[];
  packetRatePerMinute: number;
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

const MAX_IN_FLIGHT_PACKETS = 250;
const DEFAULT_HOP_DURATION_MS = 300;

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

function buildInFlightPacket(msg: Extract<WsMessage, { type: 'packet' }>, now: number, id: number): InFlightPacket | null {
  if (msg.path.length < 2) return null;

  const hopCount = msg.path.length - 1;
  const totalDuration = msg.duration && msg.duration > 0
    ? msg.duration
    : hopCount * DEFAULT_HOP_DURATION_MS;
  const hopDuration = Math.max(80, totalDuration / hopCount);

  const hops: InFlightHop[] = [];
  for (let i = 0; i < msg.path.length - 1; i++) {
    const from = msg.path[i];
    const to = msg.path[i + 1];
    const startMs = now + i * hopDuration;
    hops.push({ from, to, startMs, endMs: startMs + hopDuration });
  }

  return {
    id,
    packetType: msg.packetType,
    hash: msg.hash,
    hops,
    startedAt: now,
    finishedAt: now + hopCount * hopDuration,
  };
}

export function useWebSocket(url: string): UseWebSocketResult {
  const [graph, setGraph] = useState<GraphState>({ nodes: [], edges: [] });
  const [stats, setStats] = useState<StatsData>(DEFAULT_STATS);
  const [recentPackets, setRecentPackets] = useState<PacketEvent[]>([]);
  const [inFlightPackets, setInFlightPackets] = useState<InFlightPacket[]>([]);
  const [packetRatePerMinute, setPacketRatePerMinute] = useState(0);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const packetIdRef = useRef(0);
  const packetTimestampsRef = useRef<number[]>([]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onclose = () => {
      setConnected(false);
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

        case 'packet': {
          const now = Date.now();
          const id = packetIdRef.current++;

          setRecentPackets(prev => {
            const entry: PacketEvent = {
              id,
              packetType: msg.packetType,
              hash: msg.hash,
              pathLen: msg.pathLen,
              path: msg.path,
              duration: msg.duration,
              observerHash: msg.observerHash,
              receivedAt: now,
            };
            return [entry, ...prev].slice(0, 50);
          });

          const inFlight = buildInFlightPacket(msg, now, id);
          if (inFlight) {
            setInFlightPackets((prev) => {
              const live = prev.filter((p) => p.finishedAt >= now);
              return [inFlight, ...live].slice(0, MAX_IN_FLIGHT_PACKETS);
            });
          } else {
            setInFlightPackets((prev) => prev.filter((p) => p.finishedAt >= now));
          }

          const cutoff = now - 60_000;
          packetTimestampsRef.current.push(now);
          while (packetTimestampsRef.current.length > 0 && packetTimestampsRef.current[0] < cutoff) {
            packetTimestampsRef.current.shift();
          }
          setPacketRatePerMinute(packetTimestampsRef.current.length);
          break;
        }

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

  useEffect(() => {
    const prune = setInterval(() => {
      const now = Date.now();
      setInFlightPackets((prev) => {
        const live = prev.filter((p) => p.finishedAt >= now);
        return live.length === prev.length ? prev : live;
      });
    }, 250);

    return () => clearInterval(prune);
  }, []);

  return {
    nodes: graph.nodes,
    edges: graph.edges,
    stats,
    recentPackets,
    inFlightPackets,
    packetRatePerMinute,
    debugLogs,
    connected,
    mqttStatus: 'unknown',
  };
}
