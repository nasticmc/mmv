# AGENTS.md

This file provides guidance for coding agents working in this repository.
Its scope is the entire repo unless overridden by a deeper `AGENTS.md`.

## Project overview

MMV (Mesh MQTT Visualizer) is a real-time MeshCore network topology visualizer. It listens to MeshCore packets arriving over MQTT, infers node and edge relationships from packet path hops, persists state in SQLite, and streams live updates to a React UI over WebSocket.

- **Backend**: Node.js + TypeScript (`src/`), MQTT ingest, SQLite persistence, REST API, WebSocket broadcast
- **Frontend**: React 18 + Vite + TypeScript + D3 + react-force-graph-3d (`client/src/`)
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
  React frontend  ── renders force-directed graph (2D or 3D), stats, panels
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
    hash-utils.ts           Hex normalization and 1-byte hash extraction
    AGENTS.md               Backend-specific agent guidance
  client/
    src/
      App.tsx               Root component, layout, viz controls, state wiring
      types.ts              Shared interfaces (NodeData, EdgeData, StatsData, WsMessage)
      hooks/
        useWebSocket.ts     WebSocket connection, reconnect, state management
      components/
        NetworkGraph.tsx     2D force-directed graph (D3)
        NetworkGraph3D.tsx   3D force-directed graph (react-force-graph-3d)
        StatsBar.tsx         Top stats bar (connection, counts, packet rate)
        NodePanel.tsx        Side panel for selected node details
        PacketLog.tsx        Bottom packet activity log
        DebugPanel.tsx       Backend debug log overlay
    AGENTS.md               Frontend-specific agent guidance
  data/                     Runtime SQLite DB directory (gitignored)
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
- Frontend (Vite dev): `http://localhost:5173`
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
| `d3` 7.x | 2D force-directed graph |
| `react-force-graph-3d` 1.x | 3D force-directed graph (Three.js) |
| `three-spritetext` | 3D text labels |
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
| `VITE_PORT` | `9001` | Vite dev server port (client only) |

## Data model

### Database schema

**nodes** — Each node is identified by a 1-byte hash (2 lowercase hex chars), derived from the first byte of its Ed25519 public key.

| Column | Type | Description |
|---|---|---|
| `hash` | TEXT PK | 2-char hex (e.g. `"a3"`) |
| `public_key` | TEXT UNIQUE | Full 32-byte Ed25519 key (from Advert), nullable |
| `name` | TEXT | Node name (from Advert), nullable |
| `device_role` | INTEGER | DeviceRole enum: 0=Unknown, 1=ChatNode, 2=Repeater, 3=RoomServer, 4=Sensor |
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

**locations** — GPS coordinates keyed by public key (stored, not used for graph layout).

| Column | Type | Description |
|---|---|---|
| `public_key` | TEXT PK | Node public key |
| `latitude` | REAL | GPS latitude |
| `longitude` | REAL | GPS longitude |
| `updated_at` | INTEGER | Unix ms |

### Key concepts

- **1-byte hash**: MeshCore identifies nodes in packet paths by the first byte of their Ed25519 public key. This means hash collisions are possible (only 256 values). The visualizer treats each unique 1-byte hash as a distinct node.
- **Observer**: The MQTT gateway node that received the packet over RF and published it to MQTT. Identified from the topic structure `meshcore/<namespace>/<observer_key>/packets`. The observer is linked as the final hop in the path.
- **Advert enrichment**: When an Advert packet is decoded, the originating node is enriched with name, public key, and device role. An edge is created from the advert source to the first path hop if they differ.

## Packet processing pipeline

This is the core logic flow for every incoming MQTT message:

1. **Topic parsing** (`mqtt-client.ts`): Extract observer public key from `meshcore/+/<key>/packets`. Touch the observer node immediately.
2. **JSON envelope parsing** (`mqtt-client.ts`): Parse the MQTT payload as JSON. Extract the `raw` hex field from the packet envelope (which also contains metadata like SNR, RSSI, hash, packet_type, etc.).
3. **Packet decode** (`processor.ts:processPacket`): Decode the raw hex via `MeshCorePacketDecoder.decode()`. Reject if `!packet.isValid`.
4. **Path processing** (`processor.ts:applyPathAndObserver`):
   - Touch a node for each hash in the decoded path array
   - Touch an edge for each consecutive pair `[path[i], path[i+1]]`
   - If observer key is present, derive its hash and link the last path hop to the observer
5. **Advert enrichment**: If payload type is Advert and the decoded advert is valid:
   - Call `applyAdvert()` to upsert node with public key, name, device role
   - Store the advert record and optional location
   - Link advert source to first path hop if they differ
6. **Broadcast** (`mqtt-client.ts` → `ws-broadcast.ts`): Push updated nodes, edges, packet event (including path and duration from the envelope) to all WebSocket clients.

## WebSocket protocol

All messages are JSON with a `type` discriminator. Server-to-client only (no client-to-server messages currently).

| Type | Payload | When sent |
|---|---|---|
| `init` | `{ nodes: NodeRow[], edges: EdgeRow[], stats }` | On WebSocket connect (full snapshot) |
| `node` | `{ node: NodeRow }` | Node created or updated |
| `edge` | `{ edge: EdgeRow }` | Edge created or updated |
| `stats` | `{ stats: { nodeCount, edgeCount, advertCount, namedNodeCount } }` | Every 5 seconds |
| `packet` | `{ packetType, hash, pathLen, path, duration }` | Each successfully processed packet |
| `debug` | `{ level: 'info'|'warn'|'error', message, ts }` | Backend log events |

The frontend receives `init` on connect with the full graph state, then applies incremental `node`/`edge` messages to stay in sync.

## REST API

| Endpoint | Response |
|---|---|
| `GET /api/nodes` | `NodeRow[]` ordered by `last_seen DESC` |
| `GET /api/edges` | `EdgeRow[]` |
| `GET /api/stats` | `{ nodeCount, edgeCount, advertCount, namedNodeCount }` |
| `GET /api/graph` | `{ nodes, edges, stats }` (combined snapshot) |
| `GET /api/config` | `{ mqttDisplayName: string }` — broker label shown in the UI |

## Code conventions

- **TypeScript strict mode** everywhere. Avoid `any` unless absolutely necessary.
- **Small focused changes** over broad refactors.
- **Reuse existing helpers**: `src/db.ts` for all DB writes, `src/processor.ts` for packet logic, `src/hash-utils.ts` for hex normalization.
- **Hash normalization**: Always lowercase 2-char hex before persistence or comparison. Use `normalizeHash()` in processor.ts or `hashFromKeyPrefix()` in hash-utils.ts.
- **Deduplicate updates**: Within a single packet pass, avoid emitting duplicate node/edge updates. Check with `.some()` before pushing to the result arrays.
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
2. Add prepared statements for new operations
3. Export typed helper functions
4. Add corresponding TypeScript interfaces (`NodeRow`, `EdgeRow` pattern)

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
- 2D graph: `client/src/components/NetworkGraph.tsx` (D3 force simulation, SVG)
- 3D graph: `client/src/components/NetworkGraph3D.tsx` (react-force-graph-3d, WebGL)
- Both share `GraphSettings` from `NetworkGraph.tsx`
- Settings are controlled from the viz controls panel in `App.tsx`

## PR guidance

- Explain **what changed** and **why**.
- Include exact build/validation commands run (at minimum `npm run build`).
- If topology inference behavior changes, include a concrete packet/path example showing before and after.
- If WebSocket protocol changes, note backward compatibility implications.
- If new environment variables are added, update `.env.example`.
