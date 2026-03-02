import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

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
    public_key  TEXT UNIQUE,           -- full 32-byte Ed25519 public key if known from advert
    name        TEXT,                  -- node name from advert
    device_role INTEGER DEFAULT 0,     -- DeviceRole enum value
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

  -- Location data stored separately - not used for positioning nodes in the graph
  -- but kept for potential future use (e.g. next-hop guessing, reporting)
  CREATE TABLE IF NOT EXISTS locations (
    public_key  TEXT PRIMARY KEY,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    updated_at  INTEGER NOT NULL
  );
`);

export interface NodeRow {
  hash: string;
  public_key: string | null;
  name: string | null;
  device_role: number;
  first_seen: number;
  last_seen: number;
  packet_count: number;
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
  INSERT INTO nodes (hash, first_seen, last_seen, packet_count)
  VALUES (?, ?, ?, 1)
  ON CONFLICT(hash) DO UPDATE SET
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
`);

const updateNodeFromAdvert = db.prepare(`
  UPDATE nodes SET name = ?, device_role = ?, public_key = ?
  WHERE hash = ?
`);

const upsertNodeWithKey = db.prepare(`
  INSERT INTO nodes (hash, public_key, name, device_role, first_seen, last_seen, packet_count)
  VALUES (?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(hash) DO UPDATE SET
    public_key   = COALESCE(excluded.public_key, public_key),
    name         = COALESCE(excluded.name, name),
    device_role  = CASE WHEN excluded.device_role != 0 THEN excluded.device_role ELSE device_role END,
    last_seen    = excluded.last_seen,
    packet_count = packet_count + 1
  ON CONFLICT(public_key) DO UPDATE SET
    name         = COALESCE(excluded.name, name),
    device_role  = CASE WHEN excluded.device_role != 0 THEN excluded.device_role ELSE device_role END,
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

export function touchNode(hash: string, now: number): NodeRow {
  upsertNode.run(hash, now, now);
  return getNode.get(hash) as unknown as NodeRow;
}

export function touchEdge(fromHash: string, toHash: string, now: number): EdgeRow {
  upsertEdge.run(fromHash, toHash, now, now);
  return getEdge.get(fromHash, toHash) as unknown as EdgeRow;
}

export function applyAdvert(
  publicKey: string,
  name: string | null,
  deviceRole: number,
  timestamp: number | null,
  now: number,
  location?: { latitude: number; longitude: number }
): string {
  // The 1-byte path hash = first byte of the public key
  const hash = publicKey.slice(0, 2).toLowerCase();

  upsertNodeWithKey.run(hash, publicKey, name, deviceRole, now, now);
  insertAdvert.run(publicKey, name, deviceRole, timestamp, now);

  if (location) {
    upsertLocation.run(publicKey, location.latitude, location.longitude, now);
  }

  return hash;
}

export function getAllNodes(): NodeRow[] {
  return db.prepare('SELECT * FROM nodes ORDER BY last_seen DESC').all() as unknown as NodeRow[];
}

export function getAllEdges(): EdgeRow[] {
  return db.prepare('SELECT * FROM edges').all() as unknown as EdgeRow[];
}

export function getStats(): {
  nodeCount: number;
  edgeCount: number;
  advertCount: number;
  namedNodeCount: number;
} {
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
  const advertCount = (db.prepare('SELECT COUNT(*) as c FROM adverts').get() as { c: number }).c;
  const namedNodeCount = (
    db.prepare("SELECT COUNT(*) as c FROM nodes WHERE name IS NOT NULL").get() as { c: number }
  ).c;
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
