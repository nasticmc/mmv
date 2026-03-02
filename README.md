# MMV — Mesh Network Visualizer

A web app that connects to a LetsMesh-style MQTT server and visualises the MeshCore mesh network topology in real time.

## What it does

- Subscribes to `meshcore/+/+/packets` on your MQTT broker
- Decodes every packet with [`@michaelhart/meshcore-decoder`](https://github.com/michaelhart/meshcore-decoder)
- Extracts the **path** field from each packet — consecutive 1-byte node hashes that show which nodes relayed it
- Builds a **force-directed graph** of nodes and edges as the network is heard
- Stores **Advert** payloads to match human names against node hashes
- Stores **location data** from Adverts for future use but does **not** use it to position nodes in the graph

## Architecture

```
MQTT broker (mqtt.eastmesh.au)
       │  meshcore/+/+/packets
       ▼
  Node.js backend  ──── SQLite (data/mmv.db)
  (Express + ws)   ──── WebSocket /ws
       │
       ▼
  React frontend (D3 force graph)
```

## Setup

```bash
cp .env.example .env
# Edit .env — set MQTT_URL, credentials if needed

npm install
cd client && npm install && cd ..
```

## Run (development)

```bash
npm run dev
```

This starts:
- Backend API + WebSocket on **http://localhost:3001**
- Vite dev server on **http://localhost:5173** (with proxy to backend)

Open **http://localhost:5173** in your browser.

## Run (production)

```bash
npm run build    # builds Vite frontend into client/dist/
npm start        # serves everything from port 3001
```

## Database

SQLite at `data/mmv.db` (created automatically).

| Table | Contents |
|-------|----------|
| `nodes` | One row per unique 1-byte node hash; name + public key filled in from Adverts |
| `edges` | Directed links between consecutive path hashes, with packet counts |
| `adverts` | Raw Advert payloads — all historical node announcements |
| `locations` | Lat/lon from Adverts — stored but **not** used for positioning |

## Node identification

MeshCore path hashes are the **first byte of a node's Ed25519 public key**.
When an `Advert` packet is seen, its full public key + name is linked to the matching 1-byte hash.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_URL` | `mqtt://mqtt.eastmesh.au:1883` | MQTT broker URL |
| `MQTT_USERNAME` | — | Optional auth |
| `MQTT_PASSWORD` | — | Optional auth |
| `MQTT_CLIENT_ID` | `mmv-<random>` | Client ID |
| `MQTT_OBSERVERS` | — | Optional comma-separated observer public keys/prefixes to pre-populate as nodes at MQTT connect (e.g. `0xA1B2...,7E76...`) |
| `PORT` | `3001` | HTTP/WS server port |
| `DB_PATH` | `./data/mmv.db` | SQLite file path |
