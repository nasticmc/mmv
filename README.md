# MeshCore MQTT Visualiser

MeshCore MQTT Visualiser is a real-time MeshCore topology visualiser.

It listens to MeshCore packets from MQTT, infers node/edge relationships from path hops, stores state in SQLite, and streams live updates to a React UI over WebSocket.

## Features

- Real-time topology graph from MeshCore packet paths
- SQLite-backed persistence for nodes, edges, adverts, and locations
- Node enrichment from `Advert` payloads (name, public key, role)
- Optional observer pre-population using MQTT topic keys (`MQTT_OBSERVERS`)
- Backend debug log stream over WebSocket
- Geographic layout influence from advert lat/lng data
- Frontend controls for:
  - Label visibility and sizing
  - Link and force tuning (distance, strength, repulsion)
  - Geo influence slider (when location data is available)
  - Packet animation presets (Responsive/Balanced/Battery) and batching window
  - 3D orbit mode
  - Focus mode (quickly hide non-essential UI)

## Architecture

```text
MQTT broker
   (meshcore/+/+/packets)
          |
          v
 Node.js backend (Express + ws)
   - JSON envelope parsing
   - packet decode + processing
   - SQLite persistence
   - REST + WebSocket
          |
          v
 React frontend (Vite + D3 + Three.js)
```

## Repository layout

- `src/` — backend (MQTT ingest, packet processing, DB, API, WS)
- `client/src/` — frontend (graph rendering, panels, WS client)
- `data/mmv.db` — runtime SQLite database (auto-created)

## Requirements

- Node.js 22+
- npm

## Setup

```bash
npm install
cd client && npm install && cd ..
cp .env.example .env
```

Edit `.env` as needed (MQTT broker and auth).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MQTT_URL` | `mqtt://mqtt.example.com:1883` | MQTT broker URL |
| `MQTT_USERNAME` | _(unset)_ | Optional MQTT username |
| `MQTT_PASSWORD` | _(unset)_ | Optional MQTT password |
| `MQTT_CLIENT_ID` | `mmv-<random>` | MQTT client ID |
| `MQTT_TOPIC` | `meshcore/+/+/packets` | MQTT topic for packet JSON messages |
| `MQTT_OBSERVERS` | _(unset)_ | Comma-separated observer public keys/prefixes to pre-create observer nodes |
| `MQTT_DISPLAY_NAME` | _(unset)_ | Override broker label shown in the UI (defaults to hostname from `MQTT_URL`) |
| `PORT` | `3001` | Backend HTTP/WebSocket port |
| `DB_PATH` | `./data/mmv.db` | SQLite database path |
| `MIN_EDGE_PACKETS` | `5` | Minimum packets on an edge before it is shown to clients |
| `DEDUPE_ENABLED` | `false` | Skip packets with a message hash already seen recently |
| `GEO_ENABLED` | `true` | Set to `false` to disable geographic layout influence entirely |
| `CENTER_LAT` | _(unset)_ | Fixed latitude for geo projection centre (defaults to node centroid) |
| `CENTER_LON` | _(unset)_ | Fixed longitude for geo projection centre (defaults to node centroid) |
| `PATH_HASH_BYTES` | `1` | Bytes used for deriving node ID from public key (1, 2, or 3) |
| `VITE_PORT` | `9001` | Vite dev server port (client only) |

## Development

Run full stack:

```bash
npm run dev
```

- Backend: `http://localhost:3001`
- Frontend (Vite): `http://localhost:9001`
- WebSocket: `ws://localhost:3001/ws`

Run individual parts:

```bash
npm run dev:server
npm run dev:client
```

GUI tips:
- Mobile uses tabs to switch between **Visualizer** and **Packet log** so only one heavy pane renders at a time.
- Press `f` to toggle Focus mode and hide non-essential overlays.
- Visualizer settings persist in local storage.

## Production build and run

```bash
npm run build
npm start
```

In production mode (`NODE_ENV=production`), the backend serves `client/dist`.

## Backend APIs

### REST

- `GET /api/nodes` — all known nodes
- `GET /api/edges` — all known edges
- `GET /api/stats` — summary counts
- `GET /api/graph` — `{ nodes, edges, stats }`
- `GET /api/config` — `{ mqttDisplayName, geoEnabled, geoCenter }` runtime config for the UI

### WebSocket (`/ws`)

Message types:

- `init` — full graph + stats snapshot on connect
- `node` — incremental node update
- `edge` — incremental edge update
- `stats` — periodic stats broadcast
- `packet` — packet activity event (`packetType`, `hash`, `pathLen`, `path`, `duration`, `observerHash`)
- `debug` — backend log events (`info`/`warn`/`error`)

## Data model

SQLite tables:

- `nodes` — canonical hash nodes + metadata (`name`, `public_key`, role, counters)
- `edges` — directed path links with counters and timestamps
- `adverts` — historical advert records
- `locations` — advert location data used for geographic layout influence

## Packet processing behavior

- MQTT messages on the `/packets` topic are JSON envelopes containing a `raw` hex field and metadata (SNR, RSSI, duration, etc.)
- The `raw` hex is decoded with `@michaelhart/meshcore-decoder`
- Path hops (from the decoded packet) produce node touches and directed edge touches
- Path entries are normalized via `normalizeHash()` which handles both byte values (0-255) and hex strings
- Observer key from MQTT topic is normalized and linked as final hop when applicable
- `Advert` packets enrich node metadata and may add an advert→path edge when needed
- `duration` from the envelope is forwarded to the frontend for packet animation
- Invalid/malformed packets are ignored safely

## Notes

- Node hashes are normalized to lowercase 2-char hex strings.
- Graph layout is 3D force-directed with optional geographic influence from advert location data.
