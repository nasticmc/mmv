import { MeshCorePacketDecoder } from '@michaelhart/meshcore-decoder';
import { PayloadType } from '@michaelhart/meshcore-decoder';
import type { AdvertPayload } from '@michaelhart/meshcore-decoder';
import {
  touchNode,
  touchEdge,
  applyAdvert,
  markNodeAsTransitRepeater,
  getNodeRow,
  type NodeRow,
  type EdgeRow,
} from './db.js';
import { hashFromKeyPrefix, normalizePathHop } from './hash-utils.js';

export interface ProcessResult {
  nodes: NodeRow[];
  edges: EdgeRow[];
  packetType: string;
  hash: string;
  path: string[];
  observerHash: string | null;
}

function buildBroadcastPath(pathNodeIds: string[], observerHash: string | null): string[] {
  if (!observerHash) return pathNodeIds;
  if (pathNodeIds[pathNodeIds.length - 1] === observerHash) return pathNodeIds;
  return [...pathNodeIds, observerHash];
}

const DEVICE_ROLE_CHAT_NODE = 1;

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

function applyPathAndObserver(path: string[], pathNodeIds: string[], observerHash: string | null, now: number): { nodes: NodeRow[]; edges: EdgeRow[]; seenNodes: Set<string>; seenEdges: Set<string> } {
  const updatedNodes: NodeRow[] = [];
  const seenNodes = new Set<string>();
  const updatedEdges: EdgeRow[] = [];
  const seenEdges = new Set<string>();

  for (let i = 0; i < pathNodeIds.length; i++) {
    const nodeId = pathNodeIds[i];
    const hopHash = path[i];
    let node = touchNode(nodeId, now, hopHash);

    const isIntermediate = i > 0 && i < pathNodeIds.length - 1;
    const isObserverAdjacentRelay = Boolean(observerHash) && pathNodeIds.length > 1 && i === pathNodeIds.length - 1;
    if (isIntermediate || isObserverAdjacentRelay) {
      node = markNodeAsTransitRepeater(nodeId) ?? node;
    }

    updatedNodes.push(node);
    seenNodes.add(nodeId);
  }

  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    const edge = touchEdge(pathNodeIds[i], pathNodeIds[i + 1], now);
    seenEdges.add(`${edge.from_hash}>${edge.to_hash}`);
    updatedEdges.push(edge);
  }

  if (observerHash) {
    const observerNode = touchNode(observerHash, now, observerHash);
    if (!seenNodes.has(observerHash)) {
      updatedNodes.push(observerNode);
      seenNodes.add(observerHash);
    }

    if (pathNodeIds.length > 0) {
      const lastHopNodeId = pathNodeIds[pathNodeIds.length - 1];
      if (lastHopNodeId !== observerHash) {
        const edge = touchEdge(lastHopNodeId, observerHash, now);
        const edgeKey = `${edge.from_hash}>${edge.to_hash}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          updatedEdges.push(edge);
        }
      }
    }
  }

  return { nodes: updatedNodes, edges: updatedEdges, seenNodes, seenEdges };
}

// When true, packets with a message hash already seen recently are skipped.
// Controlled by DEDUPE_ENABLED env var (default: false).
const DEDUPE_ENABLED = (process.env.DEDUPE_ENABLED ?? 'false').toLowerCase() === 'true';

// Bounded set of recently seen packet hashes for deduplication.
// Caps at SEEN_MAX entries; oldest 10% are evicted when full.
const SEEN_MAX = 5000;
const seenPacketHashes = new Set<string>();

function isDuplicate(hash: string): boolean {
  if (seenPacketHashes.has(hash)) return true;
  if (seenPacketHashes.size >= SEEN_MAX) {
    // Sets maintain insertion order — evict the oldest entries.
    const evict = Math.ceil(SEEN_MAX * 0.1);
    const iter = seenPacketHashes.values();
    for (let i = 0; i < evict; i++) seenPacketHashes.delete(iter.next().value as string);
  }
  seenPacketHashes.add(hash);
  return false;
}

export function processPacket(hex: string, observerKey?: string): ProcessResult | null {
  let packet;
  try {
    packet = MeshCorePacketDecoder.decode(hex);
  } catch {
    return null;
  }

  if (!packet.isValid) return null;

  const msgHash = packet.messageHash as string | undefined;
  if (DEDUPE_ENABLED && msgHash && isDuplicate(msgHash)) return null;

  const now = Date.now();
  const packetType = PAYLOAD_TYPE_NAMES[packet.payloadType] ?? String(packet.payloadType);
  const path = (packet.path ?? [])
    .map((h) => normalizePathHop(h))
    .filter((h): h is string => h !== null);

  const observerHash = observerKey ? hashFromKeyPrefix(observerKey) : null;
  const { nodes: updatedNodes, edges: updatedEdges, seenNodes, seenEdges } = applyPathAndObserver(path, path, observerHash, now);
  const broadcastPath = buildBroadcastPath(path, observerHash);

  if (packet.payloadType === (PayloadType.Advert as number) && packet.payload.decoded) {
    const advert = packet.payload.decoded as AdvertPayload;
    if (advert.isValid && advert.publicKey) {
      const advertRole = advert.appData.deviceRole as number;
      const transitHashes = new Set(path.slice(1, -1));
      if (observerHash && path.length > 1) {
        transitHashes.add(path[path.length - 1]);
      }

      const advertHashCandidate = hashFromKeyPrefix(advert.publicKey);
      const shouldEnrichNode = !(
        advertHashCandidate
        && transitHashes.has(advertHashCandidate)
        && advertRole === DEVICE_ROLE_CHAT_NODE
      );

      const advertHash = applyAdvert(
        advert.publicKey,
        advert.appData.name ?? null,
        advertRole,
        advert.timestamp ?? null,
        now,
        advert.appData.hasLocation && advert.appData.location
          ? advert.appData.location
          : undefined,
        { enrichNode: shouldEnrichNode }
      );

      // Read the node row without incrementing packet_count again — applyAdvert
      // already performed the upsert (and path processing may have touched it too).
      const node = getNodeRow(advertHash);
      if (node) {
        const normalizedAdvertHash = advertHash.toLowerCase();
        const resolvedNode = transitHashes.has(normalizedAdvertHash)
          ? (markNodeAsTransitRepeater(normalizedAdvertHash) ?? node)
          : node;

        if (!seenNodes.has(advertHash)) {
          updatedNodes.push(resolvedNode);
          seenNodes.add(advertHash);
        }
      }

      if (path.length > 0 && advertHash !== path[0]) {
        const advertEdge = touchEdge(advertHash, path[0], now);
        const edgeKey = `${advertEdge.from_hash}>${advertEdge.to_hash}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
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
    path: broadcastPath,
    observerHash,
  };
}
