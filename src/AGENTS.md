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

The application entry point. Sets up Express with CORS and JSON parsing, defines four REST endpoints (`/api/nodes`, `/api/edges`, `/api/stats`, `/api/graph`), initializes the WebSocket server, starts the MQTT client, and handles graceful SIGINT shutdown.

In production mode (`NODE_ENV=production`), it also serves the built frontend from `client/dist` with a catch-all for SPA routing.

**When to modify**: Adding new REST endpoints, changing server startup behavior, or adjusting middleware.

### `mqtt-client.ts` — MQTT connection and packet dispatch

Connects to the MQTT broker, subscribes to the `/packets` topic, and dispatches incoming messages through the processing pipeline.

Key behaviors:
- **Topic parsing**: Splits topic `meshcore/<namespace>/<observer_key>/packets` to extract the observer's public key from `parts[2]`.
- **Observer node creation**: Immediately touches the observer node on every message, before packet decoding.
- **JSON envelope parsing**: Parses the MQTT payload as JSON and extracts the `raw` hex field. The envelope also contains metadata (SNR, RSSI, hash, score, duration, etc.) available for future use.
- **Packet processing**: Passes the `raw` hex to `processPacket()`. Only handles `packets` stream type.
- **Broadcast**: Iterates over result nodes and edges, broadcasting each individually to WebSocket clients.
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

**When to modify**: Supporting new MQTT topic patterns, new stream types, using additional envelope metadata, or adjusting the stats broadcast interval.

### `processor.ts` — Packet decode and topology inference

The core logic module. Single entry point:

**`processPacket(hex, observerKey?)`** — Decodes raw hex via `MeshCorePacketDecoder`:
1. Decode and validate (`isValid` check)
2. Extract path array, normalize each entry via `normalizeHash()` (handles both integer byte values 0-255 and hex string formats)
3. Call `applyPathAndObserver()` to create nodes and edges from path hops + observer
4. If Advert payload: enrich node via `applyAdvert()`, link advert source to first path hop
5. Return `{ nodes, edges, packetType, hash, path }` or `null` on failure

**`applyPathAndObserver(path, observerKey, now)`** — Internal topology builder:
- Touches a node for each path hash
- Touches an edge for each consecutive pair `[i] -> [i+1]`
- Derives observer hash from key, touches observer node, links last hop to observer
- Deduplicates nodes and edges within the result arrays using `.some()`

**When to modify**: Changing how topology is inferred from packets, supporting new payload types, or adjusting edge creation logic.

### `db.ts` — SQLite schema and persistence

All database access is centralized here. Uses `node:sqlite` `DatabaseSync` with WAL mode for concurrent reads.

**Schema** (created via `CREATE TABLE IF NOT EXISTS`):
- `nodes` — PK: `hash` (2-char hex), UNIQUE: `public_key`
- `edges` — PK: `(from_hash, to_hash)`
- `adverts` — Auto-increment PK, append-only history
- `locations` — PK: `public_key`, GPS coordinates

**Prepared statements** (all cached at module load):

Write statements:
- `upsertNode` — Insert or increment `packet_count`, update `last_seen`
- `upsertNodeWithKey` — Insert with full advert data; handles both hash and public_key conflicts via dual `ON CONFLICT` clauses
- `updateNodeFromAdvert` — Direct update of name, device_role, public_key by hash
- `upsertEdge` — Insert or increment `packet_count`, update `last_seen`
- `insertAdvert` — Append advert record
- `upsertLocation` — Insert or update GPS coordinates

Read statements:
- `getNode` / `getEdge` — Single row lookups by key
- `selectAllNodes` / `selectAllEdges` — Full table queries
- `countNodes` / `countEdges` / `countAdverts` / `countNamedNodes` — Stats counts

**Exported helpers**:
- `touchNode(hash, now)` -> `NodeRow` — Upsert node, return current row
- `touchEdge(fromHash, toHash, now)` -> `EdgeRow` — Upsert edge, return current row
- `applyAdvert(publicKey, name, deviceRole, timestamp, now, location?)` -> `string` (hash) — Full advert enrichment, returns derived hash
- `getAllNodes()` -> `NodeRow[]` — All nodes ordered by `last_seen DESC`
- `getAllEdges()` -> `EdgeRow[]` — All edges
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
- `packet` — packet activity event
- `debug` — backend log event

**`debugLog`** object replaces `console.log/warn/error` throughout the backend. Each call logs to the console AND broadcasts a `debug` message to all WebSocket clients, enabling the frontend debug panel.

**When to modify**: Adding new WebSocket message types, changing the init payload, or adjusting broadcast behavior.

### `hash-utils.ts` — Hex normalization utilities

Two small pure functions:
- `normalizeHexPrefix(value)` — Strips `0x` prefix, removes non-hex chars, lowercases. Returns a clean hex string.
- `hashFromKeyPrefix(value)` -> `string | null` — Normalizes then extracts the first 2 hex chars (the 1-byte path hash). Returns `null` if input is too short.

**When to modify**: Rarely. Only if the hash derivation logic changes.

## Processing and persistence rules

- Route **all** SQLite writes through `src/db.ts` exported helpers. Never write SQL in other files.
- In `src/processor.ts`, maintain clear phase ordering:
  1. Decode/validate packet
  2. Apply path-derived nodes/edges
  3. Apply payload-specific enrichment (e.g., advert)
  4. Apply observer-link logic
- Avoid emitting duplicate node/edge updates within a single packet pass.
- Keep hash normalization (`lowercase 2-char hex`) consistent everywhere.
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
  path: string[];        // normalized 2-char hex hashes from decoded packet
}

interface NodeRow {
  hash: string;          // 2-char lowercase hex
  public_key: string | null;
  name: string | null;
  device_role: number;   // 0-4 (DeviceRole enum)
  first_seen: number;    // unix ms
  last_seen: number;     // unix ms
  packet_count: number;
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

Topic format: `meshcore/<namespace>/<observer_public_key>/<stream_type>`

- `namespace` — grouping segment (not currently used by the backend logic)
- `observer_public_key` — hex public key of the gateway node that received the packet over RF; used to derive observer hash and link as final hop
- `stream_type` — currently only `packets` is processed (JSON envelopes containing `raw` hex); other types are logged and skipped

## Reliability

- Prefer guard clauses for invalid input.
- If decoder behavior is uncertain, fail closed (return `null`) rather than emitting partial invalid topology.
- MQTT reconnect is handled by the mqtt library (`reconnectPeriod: 5000ms`, `connectTimeout: 10000ms`).
- SQLite uses WAL mode and synchronous `DatabaseSync` — no async race conditions on writes.
