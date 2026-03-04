// Shared types between frontend and backend

export interface NodeData {
  hash: string;           // 1-byte hex (2 chars), primary key
  public_key: string | null;
  name: string | null;
  device_role: number;    // DeviceRole enum
  first_seen: number;     // unix ms
  last_seen: number;      // unix ms
  packet_count: number;
}

export interface EdgeData {
  from_hash: string;
  to_hash: string;
  first_seen: number;
  last_seen: number;
  packet_count: number;
}

export interface StatsData {
  nodeCount: number;
  edgeCount: number;
  advertCount: number;
  namedNodeCount: number;
}

export interface PacketEvent {
  packetType: string;
  hash: string;
  pathLen: number;
  path: string[];
  duration: number | null;
  receivedAt: number;
}

// DeviceRole values matching the library enum
export const DeviceRole = {
  Unknown:    0,
  ChatNode:   1,
  Repeater:   2,
  RoomServer: 3,
  Sensor:     4,
} as const;

export const ROLE_NAMES: Record<number, string> = {
  0: 'Unknown',
  1: 'Chat Node',
  2: 'Repeater',
  3: 'Room Server',
  4: 'Sensor',
};

export const ROLE_COLORS: Record<number, string> = {
  0: '#6b7280', // gray    - Unknown
  1: '#3b82f6', // blue    - ChatNode
  2: '#f97316', // orange  - Repeater
  3: '#8b5cf6', // violet  - RoomServer
  4: '#22c55e', // green   - Sensor
};

export interface DebugLogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  ts: number;
}

// WebSocket message union type
export type WsMessage =
  | { type: 'init'; nodes: NodeData[]; edges: EdgeData[]; stats: StatsData }
  | { type: 'node'; node: NodeData }
  | { type: 'edge'; edge: EdgeData }
  | { type: 'stats'; stats: StatsData }
  | { type: 'packet'; packetType: string; hash: string; pathLen: number; path: string[]; duration: number | null }
  | { type: 'debug'; level: 'info' | 'warn' | 'error'; message: string; ts: number };
