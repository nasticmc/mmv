# Versions

## [1.0.0] – 2026-03-04

### Added
- Node search with focus-fly-to in both 2D and 3D modes
- Edge highlighting for selected node connections
- 3D orbit mode — camera orbits around the selected node
- Clear-selection chip when the node panel is closed (node stays selected)
- Optional packet deduplication toggle in viz settings
- Degree-weighted repulsion and bidirectional edge deduplication
- Node colouring by device role with configurable edge packet threshold
- `VITE_PORT` environment variable for configuring the Vite dev-server port (default 9001)
- Dynamic MQTT broker label in the stats bar
- Path length and hop duration included in WebSocket packet messages

### Changed
- Switched MQTT ingest topic from `/raw` to `/packets`
- 3D mesh refresh throttled to 30 s to reduce mobile CPU usage
- Viz Settings panel is now scrollable to accommodate all controls
- All 3D force parameters (link distance, strength, repulsion, label size, link opacity) now correctly wired to the simulation

### Fixed
- MQTT topic parsing edge cases
- Search result flash on node selection
- Path hash normalisation (lowercase) and DB query performance
- 3D warmup ticks and SpriteText label caching

---

## [0.5.0] – 2026-03-04

### Added
- Split 3D visualization controls into their own settings panel section
- Orbit mode and label visibility controls for 3D graph

### Changed
- 3D graph is now the default mode
- Directional arrows removed from graph edges
- Graph state stabilised — updates no longer cause layout jitter

### Fixed
- Graph viewport preserved across node/edge updates
- Path nodes no longer retyped as chat devices on subsequent packets
- Path hop normalization for 2-digit packet hops

---

## [0.4.0] – 2026-03-03

### Added
- Optional 3D force-directed graph mode using `react-force-graph-3d` + Three.js
- Role-based node colours (repeater, client, observer, etc.)
- Connection-based node sizing (degree-weighted)
- Graph visualization controls panel (link distance, strength, repulsion, node radius, labels)
- Observer nodes pre-populated from MQTT config topics

### Changed
- MQTT subscription broadened to `meshcore/#` then narrowed to `meshcore/MEL/+/packets`
- Replaced group-channel nodes with client diamond shapes
- Live packet animation on active edges

### Fixed
- Viewport preserved across node additions (no full re-render)
- Raw binary MQTT payloads handled correctly
- Path hashes normalised to lowercase on ingest

---

## [0.3.0] – 2026-03-02

### Added
- Debug panel for streaming backend log messages to the UI over WebSocket
- Servers bound to `0.0.0.0` for LAN/container access
- Vite dev server bound to all interfaces

### Changed
- MQTT topic changed to `meshcore/#`
- Switched from `better-sqlite3` to the built-in `node:sqlite` module

---

## [0.1.0] – 2026-03-02

### Added
- Initial Mesh MQTT Visualizer web application
- Express + WebSocket backend with SQLite persistence
- React + D3 force-directed 2D graph frontend
- MQTT client with MeshCore packet decoding (`@michaelhart/meshcore-decoder`)
- Real-time node/edge updates streamed to the browser via WebSocket
- Stats bar showing node count, packet rate, and connection status
- Packet activity log
- Static file serving in production (`NODE_ENV=production`)
