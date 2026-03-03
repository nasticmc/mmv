import { MeshCorePacketDecoder } from '@michaelhart/meshcore-decoder';
import { PayloadType } from '@michaelhart/meshcore-decoder';
import type { AdvertPayload } from '@michaelhart/meshcore-decoder';
import { touchNode, touchEdge, applyAdvert, type NodeRow, type EdgeRow } from './db.js';
import { hashFromKeyPrefix } from './hash-utils.js';

export interface ProcessResult {
  nodes: NodeRow[];
  edges: EdgeRow[];
  packetType: string;
  hash: string;
}

const PAYLOAD_TYPE_NAMES: Record<number, string> = {
  0: 'Request',
  1: 'Response',
  2: 'TextMessage',
  3: 'Ack',
  4: 'Advert',
  5: 'GroupText',
  6: 'GroupData',
  7: 'AnonRequest',
  8: 'Path',
  9: 'Trace',
  10: 'Multipart',
  11: 'Control',
  15: 'RawCustom',
};

function normalizeHash(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) {
    return value.toString(16).padStart(2, '0');
  }

  if (typeof value !== 'string') return null;

  const cleaned = value.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{2}$/.test(cleaned)) return null;
  return cleaned;
}

function findPathInDecoded(obj: Record<string, unknown>): unknown[] | null {
  const direct = obj.path;
  if (Array.isArray(direct)) return direct;

  const packet = obj.packet;
  if (packet && typeof packet === 'object') {
    const nested = (packet as Record<string, unknown>).path;
    if (Array.isArray(nested)) return nested;
  }

  const decoded = obj.decoded;
  if (decoded && typeof decoded === 'object') {
    const nested = (decoded as Record<string, unknown>).path;
    if (Array.isArray(nested)) return nested;
  }

  return null;
}

function applyPathAndObserver(path: string[], observerKey: string | undefined, now: number): { nodes: NodeRow[]; edges: EdgeRow[] } {
  const updatedNodes: NodeRow[] = [];
  const updatedEdges: EdgeRow[] = [];

  for (const pathHash of path) {
    const node = touchNode(pathHash, now);
    updatedNodes.push(node);
  }

  for (let i = 0; i < path.length - 1; i++) {
    const edge = touchEdge(path[i], path[i + 1], now);
    updatedEdges.push(edge);
  }

  const observerHash = observerKey ? hashFromKeyPrefix(observerKey) : null;
  if (observerHash) {
    const observerNode = touchNode(observerHash, now);
    if (!updatedNodes.some((n) => n.hash === observerHash)) {
      updatedNodes.push(observerNode);
    }

    if (path.length > 0) {
      const lastHop = path[path.length - 1];
      if (lastHop !== observerHash) {
        const edge = touchEdge(lastHop, observerHash, now);
        if (!updatedEdges.some((e) => e.from_hash === edge.from_hash && e.to_hash === edge.to_hash)) {
          updatedEdges.push(edge);
        }
      }
    }
  }

  return { nodes: updatedNodes, edges: updatedEdges };
}

export function extractHex(raw: Buffer | string): string | null {
  const str = Buffer.isBuffer(raw) ? raw.toString('utf-8').trim() : String(raw).trim();

  if (str.startsWith('{')) {
    try {
      const obj = JSON.parse(str) as Record<string, unknown>;
      const hex = obj.hex ?? obj.data ?? obj.packet ?? obj.payload;
      if (typeof hex === 'string') return hex.trim().replace(/\s+/g, '');
    } catch {
      // fall through to raw hex
    }
  }

  const cleaned = str.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(cleaned) && cleaned.length >= 4) {
    return cleaned;
  }

  return null;
}

export function processPacket(hex: string, observerKey?: string): ProcessResult | null {
  let packet;
  try {
    packet = MeshCorePacketDecoder.decode(hex);
  } catch {
    return null;
  }

  if (!packet.isValid) return null;

  const now = Date.now();
  const packetType = PAYLOAD_TYPE_NAMES[packet.payloadType] ?? String(packet.payloadType);
  const path = (packet.path ?? []).map((h) => String(h).toLowerCase());

  const { nodes: updatedNodes, edges: updatedEdges } = applyPathAndObserver(path, observerKey, now);

  if (packet.payloadType === (PayloadType.Advert as number) && packet.payload.decoded) {
    const advert = packet.payload.decoded as AdvertPayload;
    if (advert.isValid && advert.publicKey) {
      const advertHash = applyAdvert(
        advert.publicKey,
        advert.appData.name ?? null,
        advert.appData.deviceRole as number,
        advert.timestamp ?? null,
        now,
        advert.appData.hasLocation && advert.appData.location
          ? advert.appData.location
          : undefined
      );

      const node = touchNode(advertHash, now);
      if (!updatedNodes.some((n) => n.hash === advertHash)) {
        updatedNodes.push(node);
      }

      if (path.length > 0 && advertHash !== path[0]) {
        const advertEdge = touchEdge(advertHash, path[0], now);
        if (!updatedEdges.some((e) => e.from_hash === advertEdge.from_hash && e.to_hash === advertEdge.to_hash)) {
          updatedEdges.push(advertEdge);
        }
      }
    }
  }

  return {
    nodes: updatedNodes,
    edges: updatedEdges,
    packetType,
    hash: packet.messageHash,
  };
}

export function processDecodedPacket(raw: Buffer | string, observerKey?: string): ProcessResult | null {
  const str = Buffer.isBuffer(raw) ? raw.toString('utf-8').trim() : String(raw).trim();
  if (!str.startsWith('{')) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(str) as Record<string, unknown>;
  } catch {
    return null;
  }

  const pathRaw = findPathInDecoded(obj);
  if (!pathRaw) return null;

  const path = pathRaw
    .map((entry) => normalizeHash(entry))
    .filter((entry): entry is string => entry !== null);

  if (path.length === 0) return null;

  const packetTypeRaw = obj.payloadType ?? obj.type ?? (obj.packet && typeof obj.packet === 'object' ? (obj.packet as Record<string, unknown>).payloadType : undefined);
  const packetType = typeof packetTypeRaw === 'number'
    ? (PAYLOAD_TYPE_NAMES[packetTypeRaw] ?? String(packetTypeRaw))
    : (typeof packetTypeRaw === 'string' ? packetTypeRaw : 'DecodedPacket');

  const hashRaw = obj.messageHash ?? obj.hash ?? (obj.packet && typeof obj.packet === 'object' ? (obj.packet as Record<string, unknown>).messageHash : undefined);
  const hash = typeof hashRaw === 'string' && hashRaw.length > 0 ? hashRaw : `decoded-${Date.now().toString(16)}`;

  const now = Date.now();
  const { nodes, edges } = applyPathAndObserver(path, observerKey, now);

  return { nodes, edges, packetType, hash };
}
