import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { hashFromKeyPrefix } from './hash-utils.js';

const DB_PATH = process.env.DB_PATH ?? './data/mmv.db';

// Ensure the data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: true });

// WAL mode for better concurrent read performance
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  -- Nodes identified by their 1-byte path hash (first byte of their Ed25519 public key)
  CREATE TABLE IF NOT EXISTS nodes (
    hash        TEXT PRIMARY KEY,      -- 1-byte hash as 2 hex chars (e.g. "a3")
    hop_hash    TEXT,                  -- raw path hop token (supports 1/2/3-byte hashes)
    public_key  TEXT UNIQUE,           -- full 32-byte Ed25519 public key if known from advert
    name        TEXT,                  -- node name from advert
    device_role INTEGER DEFAULT 0,     -- DeviceRole enum value
    is_observer INTEGER DEFAULT 0,     -- true when seen as MQTT observer
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    packet_count INTEGER DEFAULT 0
  );

  -- Edges between nodes (derived from consecutive path elements)
  CREATE TABLE IF NOT EXISTS edges (
    from_hash   TEXT NOT NULL,
    to_hash     TEXT NOT NULL,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    packet_count INTEGER DEFAULT 1,
    PRIMARY KEY (from_hash, to_hash)
  );

  -- Raw advert storage for historical tracking
  CREATE TABLE IF NOT EXISTS adverts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key  TEXT NOT NULL,
    name        TEXT,
    device_role INTEGER,
    timestamp   INTEGER,
    received_at INTEGER NOT NULL
  );

  -- Location data stored separately; joined into node queries to feed
  -- geographic influence forces in the frontend graph layout
  CREATE TABLE IF NOT EXISTS locations (
    public_key  TEXT PRIMARY KEY,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    updated_at  INTEGER NOT NULL
  );
`);

const nodeColumns = db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
if (!nodeColumns.some((column) => column.name === 'is_observer')) {
  db.exec('ALTER TABLE nodes ADD COLUMN is_observer INTEGER DEFAULT 0');
}
if (!nodeColumns.some((column) => column.name === 'hop_hash')) {
  db.exec('ALTER TABLE nodes ADD COLUMN hop_hash TEXT');
  db.exec('UPDATE nodes SET hop_hash = hash WHERE hop_hash IS NULL');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_hop_hash ON nodes(hop_hash)');

export interface NodeRow {
  hash: string;
  hop_hash: string | null;
  public_key: string | null;
  name: string | null;
  device_role: number;
  is_observer: number;
  first_seen: number;
  last_seen: number;
  packet_count: number;
  latitude: number | null;
  longitude: number | null;
}

export interface EdgeRow {
  from_hash: string;
  to_hash: string;
  first_seen: number;
  last_seen: number;
  packet_count: number;
}

// --- Prepared statements ---

const upsertNode = db.prepare(`
  INSERT INTO nodes (hash, hop_hash, first_seen, last_seen, packet_count, is_observer)
  VALUES (?, ?, ?, ?, 1, 0)
  ON CONFLICT(hash) DO UPDATE SET
    hop_hash     = COALESCE(nodes.hop_hash, excluded.hop_hash),
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
`);

const upsertObserverNode = db.prepare(`
  INSERT INTO nodes (hash, hop_hash, public_key, first_seen, last_seen, packet_count, is_observer)
  VALUES (?, ?, ?, ?, ?, 1, 1)
  ON CONFLICT(hash) DO UPDATE SET
    hop_hash     = COALESCE(nodes.hop_hash, excluded.hop_hash),
    public_key   = COALESCE(public_key, excluded.public_key),
    is_observer  = 1,
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
  ON CONFLICT(public_key) DO UPDATE SET
    is_observer  = 1,
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
`);

const markTransitNodeAsRepeater = db.prepare(`
  UPDATE nodes
  SET device_role = CASE WHEN is_observer = 1 THEN device_role ELSE 2 END
  WHERE hash = ?
`);

const updateNodeFromAdvert = db.prepare(`
  UPDATE nodes SET name = ?, device_role = ?, public_key = ?
  WHERE hash = ?
`);

const upsertNodeWithKey = db.prepare(`
  INSERT INTO nodes (hash, hop_hash, public_key, name, device_role, first_seen, last_seen, packet_count, is_observer)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
  ON CONFLICT(hash) DO UPDATE SET
    hop_hash     = COALESCE(nodes.hop_hash, excluded.hop_hash),
    public_key   = CASE
      WHEN device_role = 2 AND excluded.device_role = 1 THEN public_key
      ELSE COALESCE(excluded.public_key, public_key)
    END,
    name         = CASE
      WHEN device_role = 2 AND excluded.device_role = 1 THEN name
      ELSE COALESCE(excluded.name, name)
    END,
    device_role  = CASE
      WHEN device_role = 2 AND excluded.device_role = 1 THEN device_role
      WHEN excluded.device_role != 0 THEN excluded.device_role
      ELSE device_role
    END,
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
  ON CONFLICT(public_key) DO UPDATE SET
    hop_hash     = COALESCE(nodes.hop_hash, excluded.hop_hash),
    name         = CASE
      WHEN device_role = 2 AND excluded.device_role = 1 THEN name
      ELSE COALESCE(excluded.name, name)
    END,
    device_role  = CASE
      WHEN device_role = 2 AND excluded.device_role = 1 THEN device_role
      WHEN excluded.device_role != 0 THEN excluded.device_role
      ELSE device_role
    END,
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
`);

const upsertEdge = db.prepare(`
  INSERT INTO edges (from_hash, to_hash, first_seen, last_seen, packet_count)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(from_hash, to_hash) DO UPDATE SET
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
`);

const upsertEdgeAggregate = db.prepare(`
  INSERT INTO edges (from_hash, to_hash, first_seen, last_seen, packet_count)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(from_hash, to_hash) DO UPDATE SET
    first_seen   = MIN(edges.first_seen, excluded.first_seen),
    last_seen    = MAX(edges.last_seen, excluded.last_seen),
    packet_count = edges.packet_count + excluded.packet_count
`);

const insertAdvert = db.prepare(`
  INSERT INTO adverts (public_key, name, device_role, timestamp, received_at)
  VALUES (?, ?, ?, ?, ?)
`);

const upsertLocation = db.prepare(`
  INSERT INTO locations (public_key, latitude, longitude, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(public_key) DO UPDATE SET
    latitude   = excluded.latitude,
    longitude  = excluded.longitude,
    updated_at = excluded.updated_at
`);

const getNode = db.prepare(`SELECT * FROM nodes WHERE hash = ?`);
const getEdge = db.prepare(`SELECT * FROM edges WHERE from_hash = ? AND to_hash = ?`);
const getResolvedNodeByHop = db.prepare(`
  SELECT * FROM nodes
  WHERE hop_hash = ?
    AND (public_key IS NOT NULL OR name IS NOT NULL OR is_observer = 1)
  ORDER BY (hash = hop_hash) DESC, last_seen DESC
  LIMIT 1
`);
const selectOutgoingTransientEdges = db.prepare(`
  SELECT to_hash,
         MIN(first_seen) AS first_seen,
         MAX(last_seen) AS last_seen,
         SUM(packet_count) AS packet_count
  FROM edges
  WHERE from_hash LIKE ?
  GROUP BY to_hash
`);
const selectIncomingTransientEdges = db.prepare(`
  SELECT from_hash,
         MIN(first_seen) AS first_seen,
         MAX(last_seen) AS last_seen,
         SUM(packet_count) AS packet_count
  FROM edges
  WHERE to_hash LIKE ?
  GROUP BY from_hash
`);
const deleteTransientEdges = db.prepare('DELETE FROM edges WHERE from_hash LIKE ? OR to_hash LIKE ?');
const deleteTransientNodes = db.prepare('DELETE FROM nodes WHERE hash LIKE ?');
const countTransientNodesForHop = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE hash LIKE ?');
const selectEdgesForNode = db.prepare('SELECT * FROM edges WHERE from_hash = ? OR to_hash = ?');

export function touchNode(hash: string, now: number, hopHash?: string): NodeRow {
  const normalizedHash = hash.toLowerCase();
  const normalizedHopHash = (hopHash ?? normalizedHash).toLowerCase();
  upsertNode.run(normalizedHash, normalizedHopHash, now, now);
  return getNode.get(normalizedHash) as unknown as NodeRow;
}

export function touchObserverNode(observerKey: string, now: number): NodeRow | null {
  const hash = hashFromKeyPrefix(observerKey);
  if (!hash) return null;

  upsertObserverNode.run(hash, hash, observerKey, now, now);
  return getNode.get(hash) as unknown as NodeRow;
}

export function getResolvedNodeForHop(hopHash: string): NodeRow | null {
  const normalizedHopHash = hopHash.toLowerCase();
  return (getResolvedNodeByHop.get(normalizedHopHash) as unknown as NodeRow | undefined) ?? null;
}

export function markNodeAsTransitRepeater(hash: string): NodeRow | null {
  const normalizedHash = hash.toLowerCase();
  markTransitNodeAsRepeater.run(normalizedHash);
  return (getNode.get(normalizedHash) as unknown as NodeRow | undefined) ?? null;
}

export function touchEdge(fromHash: string, toHash: string, now: number): EdgeRow {
  const from = fromHash.toLowerCase();
  const to = toHash.toLowerCase();
  upsertEdge.run(from, to, now, now);
  return getEdge.get(from, to) as unknown as EdgeRow;
}

export function mergeTransientNodesForHop(hopHash: string, now: number): { node: NodeRow; edges: EdgeRow[] } | null {
  const normalizedHopHash = hopHash.toLowerCase();
  const pattern = `${normalizedHopHash}@%`;
  const transientCount = (countTransientNodesForHop.get(pattern) as { c: number }).c;
  if (transientCount === 0) return null;

  const canonicalNode = touchNode(normalizedHopHash, now, normalizedHopHash);

  db.exec('BEGIN IMMEDIATE');
  try {
    const outgoing = selectOutgoingTransientEdges.all(pattern) as Array<{ to_hash: string; first_seen: number; last_seen: number; packet_count: number }>;
    for (const edge of outgoing) {
      upsertEdgeAggregate.run(normalizedHopHash, edge.to_hash, edge.first_seen, edge.last_seen, edge.packet_count);
    }

    const incoming = selectIncomingTransientEdges.all(pattern) as Array<{ from_hash: string; first_seen: number; last_seen: number; packet_count: number }>;
    for (const edge of incoming) {
      upsertEdgeAggregate.run(edge.from_hash, normalizedHopHash, edge.first_seen, edge.last_seen, edge.packet_count);
    }

    deleteTransientEdges.run(pattern, pattern);
    deleteTransientNodes.run(pattern);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const node = getNode.get(normalizedHopHash) as unknown as NodeRow;
  const edges = selectEdgesForNode.all(normalizedHopHash, normalizedHopHash) as unknown as EdgeRow[];
  return { node, edges };
}

export function applyAdvert(
  publicKey: string,
  name: string | null,
  deviceRole: number,
  timestamp: number | null,
  now: number,
  location?: { latitude: number; longitude: number },
  options?: { enrichNode?: boolean }
): string {
  // The 1-byte path hash = first byte of the public key
  const hash = hashFromKeyPrefix(publicKey);
  if (!hash) throw new Error('Invalid advert public key: unable to derive 1-byte hash prefix');

  if (options?.enrichNode !== false) {
    upsertNodeWithKey.run(hash, hash, publicKey, name, deviceRole, now, now);
  }
  insertAdvert.run(publicKey, name, deviceRole, timestamp, now);

  if (location) {
    upsertLocation.run(publicKey, location.latitude, location.longitude, now);
  }

  return hash;
}

// Minimum packet count an edge must have before it is served to clients.
// Configurable via MIN_EDGE_PACKETS env var (default 5).
export const MIN_EDGE_PACKETS = parseInt(process.env.MIN_EDGE_PACKETS ?? '5', 10);

const selectAllNodes = db.prepare(`
  SELECT n.hash, n.hop_hash, n.public_key, n.name, n.device_role,
         n.is_observer,
         n.first_seen, n.last_seen, n.packet_count,
         l.latitude, l.longitude
  FROM nodes n
  LEFT JOIN locations l ON l.public_key = n.public_key
  ORDER BY n.last_seen DESC
`);
const selectAllEdges = db.prepare('SELECT * FROM edges WHERE packet_count >= ?');
const countNodes = db.prepare('SELECT COUNT(*) as c FROM nodes');
const countEdges = db.prepare('SELECT COUNT(*) as c FROM edges WHERE packet_count >= ?');
const countAdverts = db.prepare('SELECT COUNT(*) as c FROM adverts');
const countNamedNodes = db.prepare("SELECT COUNT(*) as c FROM nodes WHERE name IS NOT NULL");

export function getAllNodes(): NodeRow[] {
  return selectAllNodes.all() as unknown as NodeRow[];
}

export function getAllEdges(): EdgeRow[] {
  return selectAllEdges.all(MIN_EDGE_PACKETS) as unknown as EdgeRow[];
}

export function getStats(): {
  nodeCount: number;
  edgeCount: number;
  advertCount: number;
  namedNodeCount: number;
} {
  const nodeCount = (countNodes.get() as { c: number }).c;
  const edgeCount = (countEdges.get(MIN_EDGE_PACKETS) as { c: number }).c;
  const advertCount = (countAdverts.get() as { c: number }).c;
  const namedNodeCount = (countNamedNodes.get() as { c: number }).c;
  return { nodeCount, edgeCount, advertCount, namedNodeCount };
}

// Suppress the ExperimentalWarning for node:sqlite in production
if (process.env.NODE_ENV !== 'test') {
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w.name === 'ExperimentalWarning' && w.message.includes('SQLite')) return;
    process.stderr.write(`${w.name}: ${w.message}\n`);
  });
}
