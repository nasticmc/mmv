# AGENTS.md

This file provides guidance for coding agents working in this repository.
Its scope is the entire repo unless overridden by a deeper `AGENTS.md`.

## Project overview

MMV (MeshCore MQTT Visualiser) is a real-time MeshCore network topology visualizer. It listens to MeshCore packets arriving over MQTT, infers node and edge relationships from packet path hops, persists state in SQLite, and streams live updates to a React UI over WebSocket.

- **Backend**: Node.js + TypeScript (`src/`), MQTT ingest, SQLite persistence, REST API, WebSocket broadcast
- **Frontend**: React 18 + Vite + TypeScript + D3-force-3d + Three.js (`client/src/`)
- **Runtime data**: SQLite DB at `data/mmv.db` by default (auto-created)

## Architecture

```text
MQTT broker (meshcore/+/+/packets)
        |
        v
  mqtt-client.ts  ── extracts observer key from topic, parses JSON envelope
        |
        v
  processor.ts  ── decodes packet, extracts path hops, creates nodes/edges,
        |          enriches from Advert payloads
        v
  db.ts  ── SQLite upserts (nodes, edges, adverts, locations)
        |
        v
  ws-broadcast.ts  ── pushes incremental updates to all WebSocket clients
        |
        v
  React frontend  ── renders GPU-instanced 3D force-directed graph, stats, panels
```

## Repository layout

```
mmv/
  src/                      Backend source (TypeScript, compiled to dist/)
    index.ts                Express server, REST endpoints, startup/shutdown
    mqtt-client.ts          MQTT connection, topic parsing, packet dispatch
    processor.ts            Packet decode, path extraction, topology updates
    db.ts                   SQLite schema, prepared statements, all DB writes
    ws-broadcast.ts         WebSocket server, broadcast helpers, debugLog
    hash-utils.ts           Hex normalization, configurable-width hash extraction
    AGENTS.md               Backend-specific agent guidance
  client/
    src/
      App.tsx               Root component, layout, viz controls, state wiring
      types.ts              Shared interfaces (NodeData, EdgeData, StatsData, WsMessage, InFlightPacket)
      hooks/
        useWebSocket.ts     WebSocket connection, reconnect, state management
      lib/
        geo.ts              Geographic projection for node positioning
      components/
        NetworkGraph3DCustom.tsx   D3-force-3d simulation + MeshRenderer bridge
        MeshRenderer.ts           GPU-instanced Three.js renderer (InstancedMesh, LineSegments)
        StatsBar.tsx              Top stats bar (connection, counts, packet rate)
        NodePanel.tsx             Side panel for selected node details
        PacketLog.tsx             Bottom packet activity log
        DebugPanel.tsx            Backend debug log overlay (currently unused in UI)
      d3-force-3d.d.ts     Type declarations for d3-force-3d
    AGENTS.md               Frontend-specific agent guidance
  data/                     Runtime SQLite DB directory (gitignored)
  docs/
    path-disambiguation-plan.md   Forward-looking design for multi-byte path hashing
  .env.example              Environment variable template
  package.json              Root package (backend deps + scripts)
  tsconfig.json             Backend TypeScript config
```

## Quick start

```bash
npm install
cd client && npm install && cd ..
cp .env.example .env        # edit MQTT_URL / credentials if needed
npm run dev                  # runs backend + frontend concurrently
```

- Backend: `http://localhost:3001` (REST + WebSocket)
- Frontend (Vite dev): `http://localhost:9001`
- WebSocket: `ws://localhost:3001/ws`

## Build and validation

Before finalizing any change, run:

```bash
npm run build                # builds client (tsc + vite) then server (tsc)
```

If backend logic changed, also sanity-check with:

```bash
npm run dev:server           # runs backend only with tsx watch
```

If frontend logic changed:

```bash
cd client && npm run build   # type-check + vite build
```

There are no automated tests currently. Validate by building and spot-checking behavior against a live MQTT broker or using sample packets.

## Tech stack

### Backend
| Dependency | Purpose |
|---|---|
| `express` 4.x | REST API |
| `cors` 2.x | CORS middleware for Express |
| `ws` 8.x | WebSocket server |
| `mqtt` 5.x | MQTT client with auto-reconnect |
| `node:sqlite` (DatabaseSync) | SQLite with WAL mode, synchronous API |
| `@michaelhart/meshcore-decoder` | MeshCore packet decoding |
| `dotenv` | Environment variable loading |
| `tsx` (dev) | TypeScript execution with watch mode |

### Frontend
| Dependency | Purpose |
|---|---|
| `react` 18.x | UI framework |
| `vite` 5.x | Dev server and bundler |
| `d3-force-3d` | 3D force-directed simulation (D3 fork) |
| `three` | WebGL rendering (InstancedMesh, LineSegments, OrbitControls) |
| `tailwindcss` 3.x | Utility-first CSS |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MQTT_URL` | `mqtt://mqtt.example.com:1883` | MQTT broker URL |
| `MQTT_USERNAME` | _(unset)_ | Optional MQTT username |
| `MQTT_PASSWORD` | _(unset)_ | Optional MQTT password |
| `MQTT_CLIENT_ID` | `mmv-<random>` | MQTT client ID |
| `MQTT_TOPIC` | `meshcore/+/+/packets` | MQTT topic pattern for packet JSON messages |
| `MQTT_OBSERVERS` | _(unset)_ | Comma-separated observer public keys to pre-populate |
| `MQTT_DISPLAY_NAME` | _(unset)_ | Override label shown for the broker in the UI (defaults to hostname from `MQTT_URL`) |
| `PORT` | `3001` | Backend HTTP/WebSocket port |
| `DB_PATH` | `./data/mmv.db` | SQLite database file path |
| `MIN_EDGE_PACKETS` | `5` | Minimum packets on an edge before it is shown to clients |
| `DEDUPE_ENABLED` | `false` | Skip packets with a message hash already seen recently |
| `GEO_ENABLED` | `true` | Set to `false` to disable geographic layout influence entirely |
| `CENTER_LAT` | _(unset)_ | Fixed latitude for geo projection centre (defaults to node centroid) |
| `CENTER_LON` | _(unset)_ | Fixed longitude for geo projection centre (defaults to node centroid) |
| `PATH_HASH_BYTES` | `1` | Bytes used for deriving node ID from public key (1, 2, or 3) |
| `VITE_PORT` | `9001` | Vite dev server port (client only) |

## Data model

### Database schema

**nodes** — Each node is identified by a hash derived from its Ed25519 public key (default: 1-byte = 2 hex chars, configurable via `PATH_HASH_BYTES`).

| Column | Type | Description |
|---|---|---|
| `hash` | TEXT PK | Hex string (e.g. `"a3"` for 1-byte, `"a3b4"` for 2-byte) |
| `hop_hash` | TEXT | Raw path hop token (may differ from `hash` during disambiguation) |
| `public_key` | TEXT UNIQUE | Full 32-byte Ed25519 key (from Advert), nullable |
| `name` | TEXT | Node name (from Advert), nullable |
| `device_role` | INTEGER | DeviceRole enum: 0=Unknown, 1=ChatNode, 2=Repeater, 3=RoomServer, 4=Sensor |
| `is_observer` | INTEGER | 1 when the node has been seen as an MQTT observer gateway |
| `first_seen` | INTEGER | Unix ms timestamp |
| `last_seen` | INTEGER | Unix ms timestamp |
| `packet_count` | INTEGER | Incremented on each touch |

**edges** — Directed links between nodes, inferred from consecutive path hops.

| Column | Type | Description |
|---|---|---|
| `from_hash` | TEXT | Source node hash |
| `to_hash` | TEXT | Target node hash |
| `first_seen` | INTEGER | Unix ms |
| `last_seen` | INTEGER | Unix ms |
| `packet_count` | INTEGER | Incremented on each touch |

**adverts** — Historical advert records (append-only).

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `public_key` | TEXT | Advertiser's public key |
| `name` | TEXT | Advertised name, nullable |
| `device_role` | INTEGER | DeviceRole enum value |
| `timestamp` | INTEGER | Advert timestamp from packet, nullable |
| `received_at` | INTEGER | Unix ms when we received it |

**locations** — GPS coordinates keyed by public key, used for geographic layout influence in the frontend graph.

| Column | Type | Description |
|---|---|---|
| `public_key` | TEXT PK | Node public key |
| `latitude` | REAL | GPS latitude |
| `longitude` | REAL | GPS longitude |
| `updated_at` | INTEGER | Unix ms |

### Key concepts

- **Path hash**: MeshCore identifies nodes in packet paths by the first N bytes of their Ed25519 public key (default N=1, configurable via `PATH_HASH_BYTES`). With 1-byte hashes, only 256 unique values exist so collisions are possible. The visualizer treats each unique hash as a distinct node.
- **Observer**: The MQTT gateway node that received the packet over RF and published it to MQTT. Identified from the topic structure `meshcore/<namespace>/<observer_key>/packets`. The observer is linked as the final hop in the path.
- **Transit repeater**: Nodes that appear as intermediate hops in packet paths (not the origin or observer) are inferred to be repeaters and marked with `device_role=2`.
- **Advert enrichment**: When an Advert packet is decoded, the originating node is enriched with name, public key, and device role. An edge is created from the advert source to the first path hop if they differ. Transit nodes advertising as ChatNode are not enriched (to avoid overwriting repeater role from collision).

## Packet processing pipeline

This is the core logic flow for every incoming MQTT message:

1. **Topic parsing** (`mqtt-client.ts`): Extract observer public key from `meshcore/+/<key>/packets`. Touch the observer node immediately.
2. **JSON envelope parsing** (`mqtt-client.ts`): Parse the MQTT payload as JSON. Extract the `raw` hex field from the packet envelope (which also contains metadata like SNR, RSSI, hash, packet_type, duration, etc.).
3. **Packet decode** (`processor.ts:processPacket`): Decode the raw hex via `MeshCorePacketDecoder.decode()`. Reject if `!packet.isValid`.
4. **Deduplication**: If `DEDUPE_ENABLED`, skip packets with a recently-seen message hash. Uses a bounded set (5000 entries, evicts oldest 10%).
5. **Path processing** (`processor.ts:applyPathAndObserver`):
   - Touch a node for each hash in the decoded path array
   - Mark intermediate hops and observer-adjacent relays as transit repeaters
   - Touch an edge for each consecutive pair `[path[i], path[i+1]]`
   - If observer key is present, derive its hash, touch observer node, and link the last path hop to the observer
6. **Advert enrichment**: If payload type is Advert and the decoded advert is valid:
   - Determine if enrichment should be skipped (transit node advertising as ChatNode)
   - Call `applyAdvert()` to upsert node with public key, name, device role
   - Store the advert record and optional location
   - Read the node row (without double-counting) for broadcast
   - Link advert source to first path hop if they differ
7. **Broadcast** (`mqtt-client.ts` → `ws-broadcast.ts`): Push updated nodes, edges, packet event (including path, duration, and observerHash from the envelope) to all WebSocket clients.

## WebSocket protocol

All messages are JSON with a `type` discriminator. Server-to-client only (no client-to-server messages currently).

| Type | Payload | When sent |
|---|---|---|
| `init` | `{ nodes: NodeRow[], edges: EdgeRow[], stats }` | On WebSocket connect (full snapshot) |
| `node` | `{ node: NodeRow }` | Node created or updated |
| `edge` | `{ edge: EdgeRow }` | Edge created or updated (if `packet_count >= MIN_EDGE_PACKETS`) |
| `stats` | `{ stats: { nodeCount, edgeCount, advertCount, namedNodeCount } }` | Every 5 seconds |
| `packet` | `{ packetType, hash, pathLen, path, duration, observerHash }` | Each successfully processed packet |
| `debug` | `{ level: 'info'|'warn'|'error', message, ts }` | Backend log events |

The frontend receives `init` on connect with the full graph state, then applies incremental `node`/`edge` messages to stay in sync.

## REST API

| Endpoint | Response |
|---|---|
| `GET /api/nodes` | `NodeRow[]` ordered by `last_seen DESC` |
| `GET /api/edges` | `EdgeRow[]` filtered by `MIN_EDGE_PACKETS` |
| `GET /api/stats` | `{ nodeCount, edgeCount, advertCount, namedNodeCount }` |
| `GET /api/graph` | `{ nodes, edges, stats }` (combined snapshot) |
| `GET /api/config` | `{ mqttDisplayName, geoEnabled, geoCenter }` — runtime config for the UI |

## Code conventions

- **TypeScript strict mode** everywhere. Avoid `any` unless absolutely necessary.
- **Small focused changes** over broad refactors.
- **Reuse existing helpers**: `src/db.ts` for all DB writes, `src/processor.ts` for packet logic, `src/hash-utils.ts` for hex normalization.
- **Hash normalization**: Always lowercase hex before persistence or comparison. Use `normalizePathHop()` for path hops, `hashFromKeyPrefix()` for public key → hash derivation.
- **Deduplicate updates**: Within a single packet pass, avoid emitting duplicate node/edge updates. Uses Set-based tracking with O(1) lookups.
- **Fail safely**: Malformed packets return `null` rather than emitting partial topology. Use guard clauses for invalid input.
- **No new dependencies** unless strictly required.
- **Comments**: Keep short and implementation-focused.
- **Imports**: Backend uses `.js` extensions in imports (CommonJS output from tsc). Frontend uses bare imports (Vite/ESM bundling).
- **Backend TypeScript**: target ES2022, module CommonJS, strict, declaration maps
- **Frontend TypeScript**: target ES2022, module ESNext, strict, `noUnusedLocals`, `noUnusedParameters`

## Common agent tasks

### Adding a new WebSocket message type
1. Add the variant to the `WsMessage` union in `src/ws-broadcast.ts`
2. Add a `broadcast*()` helper in `ws-broadcast.ts`
3. Mirror the type variant in `client/src/types.ts` (the `WsMessage` union there)
4. Handle the new type in `client/src/hooks/useWebSocket.ts` switch statement
5. Expose new state from the hook and consume it in the relevant component

### Adding a new REST endpoint
1. Add the route handler in `src/index.ts`
2. Add any new DB query functions in `src/db.ts`

### Adding a new database table or column
1. Add `CREATE TABLE IF NOT EXISTS` in `src/db.ts` schema init block
2. Add migration check for existing DBs (check `PRAGMA table_info` before `ALTER TABLE`)
3. Add prepared statements for new operations
4. Export typed helper functions
5. Add corresponding TypeScript interfaces (`NodeRow`, `EdgeRow` pattern)

### Adding a new frontend component
1. Create the component in `client/src/components/`
2. Use Tailwind dark theme classes (`bg-gray-900`, `text-gray-300`, `border-gray-800`)
3. Use `font-mono text-xs` for telemetry-style data display
4. Import and wire it into `App.tsx`

### Modifying packet processing
1. All decode and topology logic lives in `src/processor.ts`
2. DB persistence helpers are in `src/db.ts` — do not write SQL elsewhere
3. MQTT message handling and broadcast dispatch is in `src/mqtt-client.ts`
4. If changing topology inference, provide a concrete example of input packet path and resulting nodes/edges

### Modifying graph rendering
- 3D graph component: `client/src/components/NetworkGraph3DCustom.tsx` (D3-force-3d simulation, settings bridge)
- GPU renderer: `client/src/components/MeshRenderer.ts` (Three.js InstancedMesh, LineSegments, labels, raycasting)
- Geo projection: `client/src/lib/geo.ts` (lat/lng → x/y mapping)
- Settings are controlled from the viz controls panel in `App.tsx`

## PR guidance

- Explain **what changed** and **why**.
- Include exact build/validation commands run (at minimum `npm run build`).
- If topology inference behavior changes, include a concrete packet/path example showing before and after.
- If WebSocket protocol changes, note backward compatibility implications.
- If new environment variables are added, update `.env.example`.
