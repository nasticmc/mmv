import { useEffect, useRef, useState, useCallback } from 'react';
import type { NodeData, EdgeData, StatsData, WsMessage, PacketEvent, DebugLogEntry, InFlightPacket } from '../types';

interface GraphState {
  nodes: NodeData[];
  edges: EdgeData[];
}

interface PacketFlowSettings {
  enabled: boolean;
  highlightDurationMs: number;
  highlightMode: 'fixed' | 'packetDuration';
  observationWindowMs: number;
  maxInFlightPackets: number;
}

interface PendingPacket {
  id: number;
  packetType: string;
  hash: string;
  highlightedNodes: Set<string>;
  startedAt: number;
  finishedAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
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

const DEFAULT_HOP_DURATION_MS = 300;
const MAX_PENDING_BATCHES = 120;

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

  const fixedDurationMs = Math.max(500, settings.highlightDurationMs);
  const packetDurationMs = msg.duration && msg.duration > 0
    ? Math.max(500, msg.duration)
    : Math.max(500, msg.pathLen * DEFAULT_HOP_DURATION_MS);

  const totalDuration = settings.highlightMode === 'packetDuration'
    ? packetDurationMs
    : fixedDurationMs;

  return {
    id,
    packetType: msg.packetType,
    hash: msg.hash,
    highlightedNodes,
    startedAt: now,
    finishedAt: now + totalDuration,
  };
}

function packetBatchKey(msg: Extract<WsMessage, { type: 'packet' }>): string {
  return [msg.packetType, msg.hash, msg.observerHash ?? '', msg.path.join('>')].join('|');
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
  const pendingPacketsRef = useRef(new Map<string, PendingPacket>());

  // Keep a ref to the latest settings so the stable WebSocket onmessage handler
  // always reads current values without needing to reconnect on every settings change.
  const packetFlowSettingsRef = useRef(packetFlowSettings);
  packetFlowSettingsRef.current = packetFlowSettings;

  const flushPendingPacket = useCallback((key: string) => {
    const pending = pendingPacketsRef.current.get(key);
    if (!pending) return;
    pendingPacketsRef.current.delete(key);

    setInFlightPackets((prev) => {
      const now = Date.now();
      const live = prev.filter((p) => p.finishedAt >= now);
      const merged: InFlightPacket = {
        id: pending.id,
        packetType: pending.packetType,
        hash: pending.hash,
        highlightedNodes: [...pending.highlightedNodes],
        startedAt: pending.startedAt,
        finishedAt: pending.finishedAt,
      };
      return [merged, ...live].slice(0, packetFlowSettingsRef.current.maxInFlightPackets);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const queueInFlightPacket = useCallback((msg: Extract<WsMessage, { type: 'packet' }>, packet: InFlightPacket) => {
    const now = Date.now();
    const windowMs = Math.max(0, packetFlowSettingsRef.current.observationWindowMs);

    if (windowMs === 0) {
      setInFlightPackets((prev) => {
        const live = prev.filter((p) => p.finishedAt >= now);
        return [packet, ...live].slice(0, packetFlowSettingsRef.current.maxInFlightPackets);
      });
      return;
    }

    const key = packetBatchKey(msg);
    const existing = pendingPacketsRef.current.get(key);
    if (existing && existing.expiresAt > now) {
      for (const hash of packet.highlightedNodes) {
        existing.highlightedNodes.add(hash);
      }
      existing.finishedAt = Math.max(existing.finishedAt, packet.finishedAt);
      existing.startedAt = Math.min(existing.startedAt, packet.startedAt);
      return;
    }

    if (pendingPacketsRef.current.size >= MAX_PENDING_BATCHES) {
      const oldestKey = pendingPacketsRef.current.keys().next().value;
      if (oldestKey) {
        const oldest = pendingPacketsRef.current.get(oldestKey);
        if (oldest?.timer) clearTimeout(oldest.timer);
        pendingPacketsRef.current.delete(oldestKey);
      }
    }

    const pending: PendingPacket = {
      id: packet.id,
      packetType: packet.packetType,
      hash: packet.hash,
      highlightedNodes: new Set(packet.highlightedNodes),
      startedAt: packet.startedAt,
      finishedAt: packet.finishedAt,
      expiresAt: now + windowMs,
      timer: null,
    };

    pending.timer = setTimeout(() => flushPendingPacket(key), windowMs);
    pendingPacketsRef.current.set(key, pending);
  }, [flushPendingPacket]); // eslint-disable-line react-hooks/exhaustive-deps

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
              receivedAt: now,
            };
            return [entry, ...prev].slice(0, 50);
          });

          const inFlight = buildInFlightPacket(msg, now, id, packetFlowSettingsRef.current);
          if (inFlight) {
            queueInFlightPacket(msg, inFlight);
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
      for (const pending of pendingPacketsRef.current.values()) {
        if (pending.timer) clearTimeout(pending.timer);
      }
      pendingPacketsRef.current.clear();
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
    mqttStatus: 'unknown',
  };
}
