import { MeshCorePacketDecoder } from '@michaelhart/meshcore-decoder';
import { PayloadType } from '@michaelhart/meshcore-decoder';
import type { AdvertPayload } from '@michaelhart/meshcore-decoder';
import { touchNode, touchEdge, applyAdvert, type NodeRow, type EdgeRow } from './db.js';

export interface ProcessResult {
  nodes: NodeRow[];
  edges: EdgeRow[];
  packetType: string;
  hash: string;
}

// Packet type enum values from the library
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

/**
 * Extract hex data from MQTT message payload.
 * Handles raw hex strings and simple JSON wrappers.
 */
export function extractHex(raw: Buffer | string): string | null {
  const str = Buffer.isBuffer(raw) ? raw.toString('utf-8').trim() : String(raw).trim();

  // Try JSON first (some bridges wrap in JSON)
  if (str.startsWith('{')) {
    try {
      const obj = JSON.parse(str) as Record<string, unknown>;
      const hex = obj.hex ?? obj.data ?? obj.packet ?? obj.payload;
      if (typeof hex === 'string') return hex.trim().replace(/\s+/g, '');
    } catch {
      // fall through to raw hex
    }
  }

  // Assume plain hex string
  const cleaned = str.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(cleaned) && cleaned.length >= 4) {
    return cleaned;
  }

  return null;
}

/**
 * Decode a MeshCore packet hex string and persist topology data.
 * Returns the nodes and edges that were updated.
 */
export function processPacket(hex: string, observerKey?: string): ProcessResult | null {
  let packet;
  try {
    packet = MeshCorePacketDecoder.decode(hex);
  } catch {
    return null;
  }

  if (!packet.isValid) return null;

  const now = Date.now();
  const updatedNodes: NodeRow[] = [];
  const updatedEdges: EdgeRow[] = [];
  const packetType = PAYLOAD_TYPE_NAMES[packet.payloadType] ?? String(packet.payloadType);

  // --- Process path hashes → nodes + edges ---
  const path = packet.path ?? [];

  for (const pathHash of path) {
    const node = touchNode(pathHash, now);
    updatedNodes.push(node);
  }

  // Consecutive path elements = adjacent nodes in the mesh
  for (let i = 0; i < path.length - 1; i++) {
    const edge = touchEdge(path[i], path[i + 1], now);
    updatedEdges.push(edge);
  }

  // --- Process Advert payload ---
  if (packet.payloadType === (PayloadType.Advert as number) && packet.payload.decoded) {
    const advert = packet.payload.decoded as AdvertPayload;
    if (advert.isValid && advert.publicKey) {
      const hash = applyAdvert(
        advert.publicKey,
        advert.appData.name ?? null,
        advert.appData.deviceRole as number,
        advert.timestamp ?? null,
        now,
        advert.appData.hasLocation && advert.appData.location
          ? advert.appData.location
          : undefined
      );
      // The advert node might not be in the path (zero-hop advert from observer)
      const node = touchNode(hash, now);
      if (!updatedNodes.some(n => n.hash === hash)) {
        updatedNodes.push(node);
      }
    }
  }

  // --- Observer node ---
  // If we have the observer's public key (from the MQTT topic), add it as a node
  // and create an edge from the last path element to the observer (it "heard" the packet)
  if (observerKey && observerKey.length >= 2) {
    const observerHash = observerKey.slice(0, 2).toLowerCase();
    const observerNode = touchNode(observerHash, now);
    if (!updatedNodes.some(n => n.hash === observerHash)) {
      updatedNodes.push(observerNode);
    }

    // Connect last path element to observer (observer heard the final hop)
    if (path.length > 0) {
      const lastHop = path[path.length - 1];
      if (lastHop !== observerHash) {
        const edge = touchEdge(lastHop, observerHash, now);
        if (!updatedEdges.some(e => e.from_hash === edge.from_hash && e.to_hash === edge.to_hash)) {
          updatedEdges.push(edge);
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
