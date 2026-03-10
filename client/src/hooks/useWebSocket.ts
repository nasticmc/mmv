import { useEffect, useRef, useState, useCallback } from 'react';
import type { NodeData, EdgeData, StatsData, WsMessage, PacketEvent, DebugLogEntry, InFlightPacket } from '../types';

interface GraphState {
  nodes: NodeData[];
  edges: EdgeData[];
}

interface PacketFlowSettings {
  enabled: boolean;
  highlightDurationMs: number;
  maxInFlightPackets: number;
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
}

const DEFAULT_STATS: StatsData = {
  nodeCount: 0,
  edgeCount: 0,
  advertCount: 0,
  namedNodeCount: 0,
};

function mergeNode(nodes: NodeData[], incoming: NodeData): NodeData[] {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].hash === incoming.hash) {
      if (nodes[i] === incoming) return nodes;
      const updated = nodes.slice();
      updated[i] = incoming;
      return updated;
    }
  }
  return [...nodes, incoming];
}

function mergeEdge(edges: EdgeData[], incoming: EdgeData): EdgeData[] {
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].from_hash === incoming.from_hash && edges[i].to_hash === incoming.to_hash) {
      if (edges[i] === incoming) return edges;
      const updated = edges.slice();
      updated[i] = incoming;
      return updated;
    }
  }
  return [...edges, incoming];
}

function buildInFlightPacket(
  msg: Extract<WsMessage, { type: 'packet' }>,
  now: number,
  id: number,
  settings: PacketFlowSettings,
): InFlightPacket | null {
  if (!settings.enabled || msg.path.length < 1) return null;

  const pathNodes = [...msg.path];
  if (msg.observerHash && pathNodes[pathNodes.length - 1] !== msg.observerHash) {
    pathNodes.push(msg.observerHash);
  }

  const highlightedNodes = [...new Set(pathNodes)];
  if (highlightedNodes.length === 0) return null;

  const highlightedEdges: Array<[string, string]> = [];
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const from = pathNodes[i];
    const to = pathNodes[i + 1];
    if (!from || !to) continue;
    highlightedEdges.push([from, to]);
  }

  const totalDuration = Math.max(500, settings.highlightDurationMs);

  return {
    id,
    packetType: msg.packetType,
    hash: msg.hash,
    highlightedNodes,
    highlightedEdges,
    startedAt: now,
    finishedAt: now + totalDuration,
  };
}

export function useWebSocket(url: string, packetFlowSettings: PacketFlowSettings): UseWebSocketResult {
  const [graph, setGraph] = useState<GraphState>({ nodes: [], edges: [] });
  const [stats, setStats] = useState<StatsData>(DEFAULT_STATS);
  const [recentPackets, setRecentPackets] = useState<PacketEvent[]>([]);
  const [inFlightPackets, setInFlightPackets] = useState<InFlightPacket[]>([]);
  const [packetRatePerMinute, setPacketRatePerMinute] = useState(0);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const packetIdRef = useRef(0);
  const packetTimestampsRef = useRef<number[]>([]);
  const packetTsHeadRef = useRef(0);
  // Keep a ref to the latest settings so the stable WebSocket onmessage handler
  // always reads current values without needing to reconnect on every settings change.
  const packetFlowSettingsRef = useRef(packetFlowSettings);
  packetFlowSettingsRef.current = packetFlowSettings;

  const queueInFlightPacket = useCallback((packet: InFlightPacket) => {
    const now = Date.now();
    setInFlightPackets((prev) => {
      const live = prev.filter((p) => p.finishedAt >= now);
      return [packet, ...live].slice(0, packetFlowSettingsRef.current.maxInFlightPackets);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelayRef.current = 1000;
    };

    ws.onclose = () => {
      setConnected(false);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30_000);
      reconnectTimer.current = setTimeout(connect, delay);
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
              snr: msg.snr,
              rssi: msg.rssi,
              score: msg.score,
              direction: msg.direction,
              receivedAt: now,
            };
            return [entry, ...prev].slice(0, 50);
          });

          const inFlight = buildInFlightPacket(msg, now, id, packetFlowSettingsRef.current);
          if (inFlight) {
            queueInFlightPacket(inFlight);
          } else {
            setInFlightPackets((prev) => prev.filter((p) => p.finishedAt >= now));
          }

          const cutoff = now - 60_000;
          packetTimestampsRef.current.push(now);
          while (packetTsHeadRef.current < packetTimestampsRef.current.length && packetTimestampsRef.current[packetTsHeadRef.current] < cutoff) {
            packetTsHeadRef.current++;
          }
          if (packetTsHeadRef.current > 200) {
            packetTimestampsRef.current = packetTimestampsRef.current.slice(packetTsHeadRef.current);
            packetTsHeadRef.current = 0;
          }
          setPacketRatePerMinute(packetTimestampsRef.current.length - packetTsHeadRef.current);
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
  }, [queueInFlightPacket, url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    if (inFlightPackets.length === 0) return;

    const prune = setInterval(() => {
      const now = Date.now();
      setInFlightPackets((prev) => {
        const live = prev.filter((p) => p.finishedAt >= now);
        return live.length === prev.length ? prev : live;
      });
    }, 1500);

    return () => clearInterval(prune);
  }, [inFlightPackets.length]);

  return {
    nodes: graph.nodes,
    edges: graph.edges,
    stats,
    recentPackets,
    inFlightPackets,
    packetRatePerMinute,
    debugLogs,
    connected,
  };
}
