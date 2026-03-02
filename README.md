# mmv - Mesh Map Viewer

A Flask web app that connects to an MQTT broker (`mqtt.eastmesh.au` by default), decodes mesh packets (via `meshcore-decoder` when available), and builds a live graph of observed node-to-node connectivity.

## What it stores

- **Packets**: raw payloads and basic metadata.
- **Paths**: hop-by-hop route data extracted from decoded packets.
- **Edges**: aggregated link observations between neighboring hops in a path.
- **Adverts**: node advert names so IDs can be mapped to friendly names.
- **Node locations**: persisted for future next-hop guessing research only (not used for node locating logic).

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp mmv.toml.example mmv.toml
python -m mmv_web.app
```

Open http://localhost:8000.

## Configuration

Configuration is loaded in this order:
1. Defaults in code.
2. Values from `mmv.toml` (or file pointed to by `MMV_CONFIG_FILE`).
3. Environment variables (highest precedence).

Example config file is `mmv.toml.example`:

```toml
[mmv]
mqtt_host = "mqtt.eastmesh.au"
mqtt_port = 1883
mqtt_topic = "#"
mqtt_client_id = "mmv-web"
# mqtt_username = "your-user"
# mqtt_password = "your-pass"
database_path = "mmv.sqlite3"
```

Environment variables:

- `MMV_CONFIG_FILE` (default: `mmv.toml`)
- `MMV_MQTT_HOST` (default: `mqtt.eastmesh.au`)
- `MMV_MQTT_PORT` (default: `1883`)
- `MMV_MQTT_TOPIC` (default: `#`)
- `MMV_MQTT_CLIENT_ID` (default: `mmv-web`)
- `MMV_MQTT_USERNAME` (default: unset)
- `MMV_MQTT_PASSWORD` (default: unset)
- `MMV_DATABASE_PATH` (default: `mmv.sqlite3`)

## Decoder notes

The app attempts to import `meshcore_decoder` and use it directly. If unavailable, it falls back to JSON payload decoding for development/testing.

## Tests

```bash
pytest
```
