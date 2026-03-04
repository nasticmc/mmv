import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getAllNodes, getAllEdges, getStats } from './db.js';
import type { NodeRow, EdgeRow } from './db.js';

export type WsMessage =
  | { type: 'init'; nodes: NodeRow[]; edges: EdgeRow[]; stats: ReturnType<typeof getStats> }
  | { type: 'node'; node: NodeRow }
  | { type: 'edge'; edge: EdgeRow }
  | { type: 'stats'; stats: ReturnType<typeof getStats> }
  | { type: 'packet'; packetType: string; hash: string; pathLen: number; path: string[]; duration: number | null }
  | { type: 'debug'; level: 'info' | 'warn' | 'error'; message: string; ts: number };

let wss: WebSocketServer | null = null;

export function initWss(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    // Send full graph state on connect
    const init: WsMessage = {
      type: 'init',
      nodes: getAllNodes(),
      edges: getAllEdges(),
      stats: getStats(),
    };
    ws.send(JSON.stringify(init));

    ws.on('error', () => {/* ignore client errors */});
  });
}

function broadcast(msg: WsMessage): void {
  if (!wss) return;
  const json = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

export function broadcastNode(node: NodeRow): void {
  broadcast({ type: 'node', node });
}

export function broadcastEdge(edge: EdgeRow): void {
  broadcast({ type: 'edge', edge });
}

export function broadcastStats(): void {
  broadcast({ type: 'stats', stats: getStats() });
}

export function broadcastPacket(packetType: string, hash: string, pathLen: number, path: string[], duration: number | null): void {
  broadcast({ type: 'packet', packetType, hash, pathLen, path, duration });
}

export function broadcastDebug(level: 'info' | 'warn' | 'error', message: string): void {
  broadcast({ type: 'debug', level, message, ts: Date.now() });
}

/** Drop-in replacements for console that also push to WebSocket clients */
export const debugLog = {
  info:  (msg: string) => { console.log(msg);  broadcastDebug('info',  msg); },
  warn:  (msg: string) => { console.warn(msg); broadcastDebug('warn',  msg); },
  error: (msg: string) => { console.error(msg); broadcastDebug('error', msg); },
};
