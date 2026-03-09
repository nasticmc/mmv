# AGENTS.md (backend)

Scope: `src/` — the Node.js backend.

## Backend workflow

```bash
npm run dev:server           # run with tsx watch (auto-reload)
npm run build:server         # compile TypeScript to dist/ via tsc
npm run build                # full build (client + server)
```

The backend compiles to CommonJS (`dist/`). Production entry point: `node dist/index.js`.

## Module guide

### `index.ts` — HTTP server and REST API

The application entry point. Sets up Express with CORS and JSON parsing, defines REST endpoints, initializes the WebSocket server, starts the MQTT client, and handles graceful SIGINT shutdown.

In production mode, it serves the built frontend from `client/dist` with a catch-all for SPA routing.

**REST endpoints**:
- `GET /api/nodes` — all known nodes (joined with location data)
- `GET /api/edges` — all edges with `packet_count >= MIN_EDGE_PACKETS`
- `GET /api/stats` — summary counts (nodes, edges, adverts, named nodes)
- `GET /api/graph` — `{ nodes, edges, stats }` combined snapshot
- `GET /api/config` — `{ mqttDisplayName, geoEnabled, geoCenter }`: runtime UI config

**When to modify**: Adding new REST endpoints, changing server startup behavior, or adjusting middleware.

### `mqtt-client.ts` — MQTT connection and packet dispatch

Connects to the MQTT broker, subscribes to the `/packets` topic, and dispatches incoming messages through the processing pipeline.

Key behaviors:
- **Topic parsing**: Validates topic format `meshcore/<namespace>/<observer_key>/packets` (exactly 4 segments). Extracts observer public key from `parts[2]`.
- **Observer node creation**: Immediately touches the observer node on every message, before packet decoding. Only broadcasts the observer node once per session (tracked via `seenObserverHashes` Set) to avoid unnecessary client-side re-renders.
- **JSON envelope parsing**: Parses the MQTT payload as JSON and extracts the `raw` hex field.
- **Packet processing**: Passes the `raw` hex and observer key to `processPacket()`.
- **Duration extraction**: Extracts `duration` from the envelope (handles both string and number formats), validates with `Number.isFinite`.
- **Broadcast**: Iterates over result nodes and edges, broadcasting each individually. Edges are only broadcast when `packet_count >= MIN_EDGE_PACKETS`.
- **Stats timer**: Broadcasts stats every 5 seconds via `setInterval`.
- **Observer pre-population**: On connect, reads `MQTT_OBSERVERS` env var and creates nodes for each configured key.

**Packet envelope fields** (available in the JSON but not all currently used):
- `raw` — hex packet data (extracted and decoded)
- `duration` — packet transmission duration in ms (extracted and broadcast to frontend)
- `SNR`, `RSSI` — signal quality metrics (not yet used)
- `hash` — packet hash from the gateway (not yet used)
- `packet_type` — payload type as string (not yet used)
- `score` — reception quality score (not yet used)
- `direction` — `rx`/`tx` (not yet used)
- `timestamp`, `time`, `date` — reception timing (not yet used)

**When to modify**: Supporting new MQTT topic patterns, using additional envelope metadata, or adjusting the stats broadcast interval.

### `processor.ts` — Packet decode and topology inference

The core logic module. Single entry point:

**`processPacket(hex, observerKey?)`** — Decodes raw hex via `MeshCorePacketDecoder`:
1. Decode and validate (`isValid` check)
2. Optional deduplication via `isDuplicate()` (controlled by `DEDUPE_ENABLED`)
3. Extract path array, normalize each entry via `normalizePathHop()` (handles integer byte values and hex string formats)
4. Call `applyPathAndObserver()` to create nodes and edges from path hops + observer
5. If Advert payload: enrich node via `applyAdvert()`, read node row via `getNodeRow()` (avoids double-counting), link advert source to first path hop
6. Return `{ nodes, edges, packetType, hash, path, observerHash }` or `null` on failure

**`applyPathAndObserver(path, pathNodeIds, observerHash, now)`** — Internal topology builder:
- Touches a node for each path hash (with `hop_hash` tracking)
- Marks intermediate hops and observer-adjacent relays as transit repeaters
- Touches an edge for each consecutive pair `[i] -> [i+1]`
- Derives observer hash from key, touches observer node, links last hop to observer
- Deduplicates nodes and edges within the result using Sets

**Transit repeater detection**:
- Intermediate path hops (not first, not last) are marked as repeaters
- When an observer is present and path has > 1 hop, the last path hop is also marked as a transit repeater (it's relaying to the observer)
- `markNodeAsTransitRepeater()` only updates `device_role` to 2 (Repeater) when `is_observer = 0`, preserving observer identity

**Advert enrichment guards**:
- Transit hashes are computed as `path.slice(1, -1)` plus the last hop when observer is present
- If the advert hash matches a transit hash AND the advertised role is ChatNode, enrichment is skipped (`shouldEnrichNode = false`). This prevents a chat node's advert from overwriting a repeater identity that was inferred from path position.

**Deduplication**:
- Controlled by `DEDUPE_ENABLED` env var (default: false)
- Uses a bounded Set of 5000 entries; evicts the oldest 10% when full
- Keyed on `packet.messageHash`

**When to modify**: Changing how topology is inferred from packets, supporting new payload types, or adjusting edge creation logic.

### `db.ts` — SQLite schema and persistence

All database access is centralized here. Uses `node:sqlite` `DatabaseSync` with WAL mode for concurrent reads.

**Schema** (created via `CREATE TABLE IF NOT EXISTS`):
- `nodes` — PK: `hash`, UNIQUE: `public_key`, with `hop_hash` and `is_observer` columns (auto-migrated for existing DBs)
- `edges` — PK: `(from_hash, to_hash)`
- `adverts` — Auto-increment PK, append-only history
- `locations` — PK: `public_key`, GPS coordinates

**Indexes**:
- `idx_nodes_hop_hash` on `nodes(hop_hash)` — for hop disambiguation queries

**Prepared statements** (all cached at module load):

Write statements:
- `upsertNode` — Insert or increment `packet_count`, update `last_seen`; uses `COALESCE` for `hop_hash`
- `upsertObserverNode` — Like `upsertNode` but sets `is_observer = 1` and accepts `public_key`; dual `ON CONFLICT` on `hash` and `public_key`
- `upsertNodeWithKey` — Insert with full advert data; handles both hash and public_key conflicts via dual `ON CONFLICT` clauses; protects repeater identity from ChatNode downgrades
- `updateNodeFromAdvert` — Direct update of name, device_role, public_key by hash
- `markTransitNodeAsRepeater` — Sets `device_role = 2` only when `is_observer = 0`
- `upsertEdge` — Insert or increment `packet_count`, update `last_seen`
- `upsertEdgeAggregate` — Merge edge with aggregate counters (MIN first_seen, MAX last_seen, SUM packet_count) for transient node merges
- `insertAdvert` — Append advert record
- `upsertLocation` — Insert or update GPS coordinates

Read statements:
- `getNode` / `getEdge` — Single row lookups by key
- `getResolvedNodeByHop` — Find the best canonical node for a hop hash (prefers nodes with known identity)
- `selectOutgoingTransientEdges` / `selectIncomingTransientEdges` — Aggregate transient edges for merge
- `selectEdgesForNode` — All edges connected to a given node
- `selectAllNodes` — All nodes LEFT JOIN locations (ordered by `last_seen DESC`)
- `selectAllEdges` — Edges filtered by `MIN_EDGE_PACKETS`
- `countNodes` / `countEdges` / `countAdverts` / `countNamedNodes` — Stats counts

**Exported helpers**:
- `getNodeRow(hash)` -> `NodeRow | null` — Read-only node lookup (no side effects)
- `touchNode(hash, now, hopHash?)` -> `NodeRow` — Upsert node, return current row
- `touchObserverNode(observerKey, now)` -> `NodeRow | null` — Upsert observer node from public key
- `touchEdge(fromHash, toHash, now)` -> `EdgeRow` — Upsert edge, return current row
- `markNodeAsTransitRepeater(hash)` -> `NodeRow | null` — Set device_role=2 (unless observer)
- `getResolvedNodeForHop(hopHash)` -> `NodeRow | null` — Find canonical node for a hop hash
- `mergeTransientNodesForHop(hopHash, now)` -> `{ node, edges } | null` — Merge all transient nodes for a hop into a canonical node (used during disambiguation)
- `applyAdvert(publicKey, name, deviceRole, timestamp, now, location?, options?)` -> `string` (hash) — Full advert enrichment with optional `enrichNode: false` to skip node identity update
- `getAllNodes()` -> `NodeRow[]` — All nodes with location data joined
- `getAllEdges()` -> `EdgeRow[]` — Edges filtered by MIN_EDGE_PACKETS
- `getStats()` -> `{ nodeCount, edgeCount, advertCount, namedNodeCount }`

**Key interfaces**: `NodeRow`, `EdgeRow` — exported and used across the backend and mirrored in `client/src/types.ts`.

**When to modify**: Adding tables/columns, new query patterns, or changing upsert behavior. All SQL must stay in this file.

### `ws-broadcast.ts` — WebSocket server and broadcast

Manages the WebSocket server (mounted at `/ws` on the HTTP server) and provides broadcast helpers.

**Message types** (defined as `WsMessage` union):
- `init` — full graph snapshot sent to each new client on connect
- `node` — single node update
- `edge` — single edge update
- `stats` — periodic stats
- `packet` — packet activity event (includes `observerHash`)
- `debug` — backend log event

**`debugLog`** object replaces `console.log/warn/error` throughout the backend. Each call logs to the console AND broadcasts a `debug` message to all WebSocket clients, enabling the frontend debug panel.

**When to modify**: Adding new WebSocket message types, changing the init payload, or adjusting broadcast behavior.

### `hash-utils.ts` — Hex normalization utilities

Pure functions for hash derivation:
- `normalizeHexPrefix(value)` — Strips `0x` prefix, removes non-hex chars, lowercases. Returns a clean hex string.
- `hashFromKeyPrefix(value)` -> `string | null` — Normalizes then extracts the first N hex chars (configurable via `PATH_HASH_BYTES` env var, default 1 byte = 2 chars). Returns `null` if input is too short.
- `hashFromKeyPrefixWithBytes(value, bytes)` -> `string | null` — Same as above but with explicit byte width parameter.
- `normalizePathHop(value)` -> `string | null` — Normalizes decoded hop values to canonical lowercase even-length hex. Handles integers (0–0xFF → 2 chars, 0–0xFFFF → 4 chars, 0–0xFFFFFF → 6 chars) and hex strings (2–6 chars, must be even length).

**Configuration**: `PATH_HASH_BYTES` env var (default `1`) controls the byte width used by `hashFromKeyPrefix()`. Clamped to [1, 3].

**When to modify**: Rarely. Only if the hash derivation logic or configurable width behavior changes.

## Processing and persistence rules

- Route **all** SQLite writes through `src/db.ts` exported helpers. Never write SQL in other files.
- In `src/processor.ts`, maintain clear phase ordering:
  1. Decode/validate packet
  2. Deduplication check (if enabled)
  3. Apply path-derived nodes/edges (with transit repeater marking)
  4. Apply payload-specific enrichment (e.g., advert)
  5. Construct broadcast path (including observer)
- Use `getNodeRow()` for read-only lookups to avoid double-counting `packet_count`.
- Avoid emitting duplicate node/edge updates within a single packet pass — use Sets.
- Keep hash normalization (`lowercase hex`) consistent everywhere.
- All timestamps use `Date.now()` (Unix milliseconds).

## Error handling patterns

- Prefer guard clauses for invalid input (`if (!x) return null`).
- Decoder failures are caught with try/catch and return `null` — no partial topology emitted.
- MQTT client errors are logged via `debugLog` and do not crash the process.
- WebSocket client errors are silently ignored (client disconnects are expected).
- The `ExperimentalWarning` for `node:sqlite` is suppressed in non-test environments.

## Key types

```typescript
interface ProcessResult {
  nodes: NodeRow[];
  edges: EdgeRow[];
  packetType: string;    // e.g. "Advert", "TextMessage", "Trace"
  hash: string;          // packet messageHash
  path: string[];        // broadcast path including observer
  observerHash: string | null;  // observer node hash (if known)
}

interface NodeRow {
  hash: string;          // lowercase hex (2 chars for 1-byte, 4 for 2-byte, etc.)
  hop_hash: string | null; // raw hop token for disambiguation
  public_key: string | null;
  name: string | null;
  device_role: number;   // 0-4 (DeviceRole enum)
  is_observer: number;   // 1 if seen as MQTT observer gateway
  first_seen: number;    // unix ms
  last_seen: number;     // unix ms
  packet_count: number;
  latitude: number | null;  // from locations JOIN
  longitude: number | null; // from locations JOIN
}

interface EdgeRow {
  from_hash: string;
  to_hash: string;
  first_seen: number;
  last_seen: number;
  packet_count: number;
}
```

## Payload type reference

| Value | Name | Notes |
|---|---|---|
| 0 | Request | |
| 1 | Response | |
| 2 | TextMessage | |
| 3 | Ack | |
| 4 | Advert | Triggers node enrichment with name, key, role |
| 5 | GroupText | |
| 6 | GroupData | |
| 7 | AnonRequest | |
| 8 | Path | |
| 9 | Trace | |
| 10 | Multipart | |
| 11 | Control | |
| 15 | RawCustom | |

## MQTT topic structure

Default subscription: `meshcore/+/+/packets`

Topic format: `meshcore/<namespace>/<observer_public_key>/packets`

- `namespace` — grouping segment (not currently used by the backend logic)
- `observer_public_key` — hex public key of the gateway node that received the packet over RF; used to derive observer hash and link as final hop
- Only the `packets` stream type is processed (JSON envelopes containing `raw` hex)

## Reliability

- Prefer guard clauses for invalid input.
- If decoder behavior is uncertain, fail closed (return `null`) rather than emitting partial invalid topology.
- MQTT reconnect is handled by the mqtt library (`reconnectPeriod: 5000ms`, `connectTimeout: 10000ms`).
- SQLite uses WAL mode and synchronous `DatabaseSync` — no async race conditions on writes.
