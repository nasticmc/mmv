# AGENTS.md (client)

Scope: `client/` — the React frontend.

## Frontend workflow

```bash
cd client
npm run dev                  # Vite dev server on http://localhost:9001
npm run build                # TypeScript check + Vite production build
npm run preview              # preview production build locally
```

The frontend is a standalone Vite+React app. In development, it runs on port 9001 and proxies WebSocket connections to the backend on port 3001. In production, it is served as static files by the Express backend from `client/dist`.

## Component hierarchy

```
App.tsx
  +-- StatsBar                    Top bar: connection status, counts, packet rate
  +-- NetworkGraph3DCustom        D3-force-3d simulation + MeshRenderer bridge
  |     +-- MeshRenderer          GPU-instanced Three.js renderer (InstancedMesh, LineSegments)
  +-- NodeSearch (inline)         Search overlay for finding nodes by name/hash
  +-- NodePanel                   Side panel for selected node details + neighbours
  +-- PacketLog                   Bottom bar showing recent packet activity
  +-- RangeControl (inline)       Reusable range slider for viz settings
  +-- ToggleControl (inline)      Reusable checkbox toggle for viz settings
```

Note: `DebugPanel` component exists but is not currently wired into the UI (debug button was removed in 0.7.0).

## Component guide

### `App.tsx` — Root component and state wiring

Orchestrates the entire UI. Manages top-level state:
- `selectedId` — currently selected node hash (drives NodePanel)
- `panelOpen` — whether the NodePanel is expanded
- `showVizControls` — toggles the visualization settings panel
- `graphSettings` — `GraphSettings` object controlling the 3D renderer (persisted in localStorage)
- `mobileTab` — `'visualizer' | 'packets'` tab selection for mobile layout (persisted)
- `focusMode` — hides non-essential overlays (persisted, toggled via `f` key)
- `mqttDisplayName` — broker label fetched from `GET /api/config` on mount
- `geoEnabled` — whether geographic layout is active (from `/api/config`)
- `geoCenter` — fixed lat/lng center for geo projection (from `/api/config`)
- `focusNodeId` / `focusKey` — drives camera fly-to on node search selection
- `isMobileViewport` — tracks viewport width < 768px for responsive layout

WebSocket URL is auto-detected: port 9001 (Vite dev) connects to `ws://hostname:3001/ws`, otherwise uses `ws://host/ws` (with protocol upgrade for HTTPS). API calls in dev target `http://hostname:3001`.

**Inline components**:
- `NodeSearch` — autocomplete search over nodes by name or hash, with dropdown results (max 6)
- `RangeControl` — labeled range input with optional disabled state
- `ToggleControl` — labeled checkbox toggle with optional disabled state

**When to modify**: Adding new panels, changing layout, or wiring new state from the WebSocket hook.

### `hooks/useWebSocket.ts` — WebSocket connection and state management

Custom React hook that manages the full client-side state:

**State managed**:
- `graph.nodes: NodeData[]` — all known nodes
- `graph.edges: EdgeData[]` — all known edges
- `stats: StatsData` — latest stats snapshot
- `recentPackets: PacketEvent[]` — last 50 packet events (FIFO)
- `inFlightPackets: InFlightPacket[]` — active packet path highlights for animation
- `packetRatePerMinute: number` — computed from packet timestamps within last 60s
- `debugLogs: DebugLogEntry[]` — last 200 debug log entries (FIFO)
- `connected: boolean` — WebSocket connection status

**Hook signature**: `useWebSocket(url: string, packetFlowSettings: PacketFlowSettings)`

`PacketFlowSettings` controls packet animation behavior:
- `enabled` — whether to build in-flight packet highlights
- `highlightDurationMs` — how long each packet highlight lasts
- `maxInFlightPackets` — cap on concurrent highlights (lower on mobile)

**Message handling** (switch on `msg.type`):
- `init` — replaces full graph state and stats (sent on connect)
- `node` — merges single node into state (upsert by `hash`)
- `edge` — merges single edge into state (upsert by `from_hash + to_hash`)
- `stats` — replaces stats
- `packet` — prepends to recent packets (capped at 50), builds in-flight highlight, updates packet rate
- `debug` — prepends to debug logs (capped at 200)

**Reconnect**: Uses exponential backoff (1s → 30s cap). On error, closes the socket (triggering the close handler).

**Merge functions**: `mergeNode()` and `mergeEdge()` perform immutable array updates with early-exit linear scan and identity check to avoid unnecessary copies.

**Packet rate tracking**: Uses index-based pointer into a timestamps array with periodic compaction (avoids O(n) `Array.shift()`).

**In-flight packet cleanup**: A `setInterval` prunes expired in-flight packets every 1.5s when any are active.

**When to modify**: Handling new WebSocket message types, changing state shape, or adjusting reconnect behavior.

### `components/NetworkGraph3DCustom.tsx` — 3D force simulation bridge

Owns the D3-force-3d simulation and bridges React state to the imperative MeshRenderer. React state mutations happen only for topology/settings/selection changes — D3 tick calls `renderer.updatePositions()` directly (no React setState per tick).

**Key types**:
- `GraphSettings` — exported settings interface used by App.tsx
- `GraphSimNode` — extends both SimNode (mesh data) and SimNode3D (D3 position data)
- `GraphSimLink` — D3 link with GraphSimNode endpoints

**Force simulation** (d3-force-3d, 3 dimensions):
- `charge` — degree-weighted many-body (hub nodes repel harder)
- `link` — configurable distance and strength from settings
- `center` — centering at origin
- `geoX` / `geoY` — optional geo-attraction forces (when nodes have lat/lng)

**Structural fingerprinting**: Uses sorted node-id and edge-key fingerprints to detect real topology changes. Pure packet-count / last-seen updates (same nodes, same edges) skip topology rebuild and D3 reheat entirely.

**Display fingerprinting**: Tracks `name:role:is_observer` per node. Changes trigger `refreshMetadata()` (cheap label/color update) without full topology rebuild.

**Geo forces**: Only reheat the simulation when geo influence weight, center, or node set actually changes — prevents jitter from packet-count updates.

**Initial warmup**: On first load (empty graph → nodes), runs 100 synchronous D3 ticks before rendering so nodes appear settled rather than scattering from origin.

**When to modify**: Changing force parameters, adding new visual layers, or adjusting simulation behavior.

### `components/MeshRenderer.ts` — GPU-instanced Three.js renderer

All nodes as a single `THREE.InstancedMesh` (1 draw call). All edges as a single `THREE.LineSegments` (1 draw call). Labels are individual `THREE.Sprite` objects with canvas-rendered text.

**Public API**:
- `setTopology(nodes, links)` — full rebuild of index maps, matrices, edge geometry, labels
- `updatePositions(nodes)` — per-tick update of instance matrices and edge endpoints
- `refreshMetadata(nodes)` — update labels and base colours without topology rebuild
- `updateColors(nodes, selectedId)` — selection-aware colour update with neighbour dimming
- `setPacketHits(nodeHits, edgeHits)` — packet-path highlights with thick red Line2 overlay
- `setLinkOpacity(opacity)` / `setLabelsVisible(visible)` / `setLabelSize(size)`
- `flyTo(x, y, z)` — animated camera fly-to with ease-in-out quadratic
- `setOrbitMode(enabled, focusId)` — camera orbits around selected node or centroid
- `getNodePosition(id)` — world-space position lookup for focus/orbit

**Selection behaviour**:
- Selected node → green (#22c55e)
- Direct neighbours → base colour lerped toward light green
- Unconnected nodes → dimmed to 25% brightness
- Connected edges highlighted with thick Line2 overlay

**Input handling**: Click and touch-tap detection with raycast against InstancedMesh. Touch drag threshold (8px) prevents accidental taps during pan/zoom.

**When to modify**: Changing node appearance, edge rendering, custom geometries, or interaction behavior.

### `lib/geo.ts` — Geographic projection

`projectGeo(nodes, scale, center?)` — Projects node lat/lng to x/y coordinates for force seeding and geo-attraction forces.

- Filters to nodes with both lat and lng
- Center defaults to centroid (mean) of all located nodes, or uses provided fixed center
- Scale normalizes positions relative to the geographic span
- Returns `Map<string, { x, y }>` keyed by node hash

**When to modify**: Changing projection method or adding altitude (z-axis) support.

### `components/StatsBar.tsx` — Top statistics bar

Compact horizontal bar showing:
- MMV title
- Connection status indicator (green dot + "live" / red dot + "offline")
- Node count, named node count
- Packet rate per minute (only shown when > 0)
- `mqttDisplayName` below the main row

Uses the `Stat` sub-component for each metric (value + label pair).

**When to modify**: Adding new metrics or changing the status indicator behavior.

### `components/NodePanel.tsx` — Node detail side panel

Right-side panel shown when a node is selected (bottom sheet on mobile). Displays:
- Node name (or "Node XX" fallback) with role color indicator
- Hash, role name, observer status, packet count, first/last seen timestamps
- Public key (if known from advert, displayed in a code block)
- Neighbour list (connected edges with direction arrows and packet counts)
- Location coordinates (if available)

Helper functions: `formatTime()` for timestamp display, `timeAgo()` for relative time.

**When to modify**: Adding new node fields, changing the detail layout, or making neighbours clickable.

### `components/PacketLog.tsx` — Packet activity log

Bottom bar (or full-height on mobile tab) showing the 50 most recent packet events in reverse chronological order. Each row shows: timestamp, packet type (color-coded), message hash, hop count, and observer hash.

Packet type colors are defined in `TYPE_COLORS` map (e.g., Advert=emerald, Trace=yellow, TextMessage=blue).

**When to modify**: Adding new columns, changing the color scheme, or adjusting the max visible count.

### `components/DebugPanel.tsx` — Backend debug log overlay

Floating panel (fixed position, bottom-right) that displays backend log entries streamed over WebSocket. Shows logs in reverse chronological order with ISO timestamps and color-coded levels (info=gray, warn=yellow, error=red).

Currently not wired into the UI (debug toggle was removed in 0.7.0). The component and WebSocket message handling remain available for re-enabling.

**When to modify**: Re-enabling the debug panel or adding log filtering/search.

## Type system

All shared types are centralized in `client/src/types.ts`:

```typescript
interface NodeData {
  hash: string;              // hex string, primary key
  public_key: string | null;
  name: string | null;
  device_role: number;       // DeviceRole enum (0-4)
  is_observer: number;       // 1 if MQTT observer gateway
  first_seen: number;        // unix ms
  last_seen: number;         // unix ms
  packet_count: number;
  latitude: number | null;   // from locations JOIN
  longitude: number | null;  // from locations JOIN
}

interface EdgeData {
  from_hash: string;
  to_hash: string;
  first_seen: number;
  last_seen: number;
  packet_count: number;
}

interface StatsData {
  nodeCount: number;
  edgeCount: number;
  advertCount: number;
  namedNodeCount: number;
}

interface PacketEvent {
  id: number;
  packetType: string;
  hash: string;
  pathLen: number;
  path: string[];
  duration: number | null;
  observerHash: string | null;
  receivedAt: number;        // added client-side
}

interface InFlightPacket {
  id: number;
  packetType: string;
  hash: string;
  highlightedNodes: string[];
  highlightedEdges: Array<[string, string]>;
  startedAt: number;
  finishedAt: number;
}

interface DebugLogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  ts: number;
}
```

**Constants**:
- `DeviceRole` — enum object: Unknown(0), ChatNode(1), Repeater(2), RoomServer(3), Sensor(4)
- `ROLE_NAMES` — maps role number to display name
- `ROLE_COLORS` — maps role number to hex color (gray, blue, orange, violet, green)

**`WsMessage`** — discriminated union matching the backend's WebSocket protocol. Keep in sync with `src/ws-broadcast.ts`.

## Styling conventions

- **Dark theme throughout**: `bg-gray-950` (app background), `bg-gray-900` (panels/bars), `bg-gray-800` (interactive elements, hover states)
- **Borders**: `border-gray-800` (panel separators), `border-gray-700` (interactive controls)
- **Text hierarchy**: `text-gray-100` (primary), `text-gray-300` (secondary), `text-gray-500` (labels/muted), `text-gray-600` (very muted)
- **Font**: `font-mono` for all telemetry data, hash values, and timestamps
- **Sizing**: `text-xs` for most data, `text-sm` for panel body text, `text-base` for stat values
- **Accent colors**: `purple-500/600` for viz controls, `indigo-600` for focus mode toggle, `yellow-400` for selected state, `cyan-400` for observer indicators, role colors for node indicators
- **Graph background**: `#030712` (matches `bg-gray-950`)

## Graph settings (`GraphSettings`)

Controlled from App.tsx viz panel, persisted in localStorage:

| Setting | Default | Range | Notes |
|---|---|---|---|
| `minNodeRadius` | 9 | 5-18 | Node sphere size in both InstancedMesh and labels |
| `linkDistance` | 150 | 60-220 | D3-force-3d link distance |
| `linkStrength` | 0.5 | 0.1-1.0 | D3-force-3d link strength |
| `chargeStrength` | -350 | -80 to -800 | D3-force-3d many-body (negative = repulsion, degree-weighted) |
| `showLabels` | true | toggle | Show/hide node name/hash label sprites |
| `threeDLinkOpacity` | 0.25 | 0.1-1.0 | Edge line opacity |
| `threeDLabelSize` | 6 | 3-12 | SpriteText canvas font height multiplier |
| `orbit` | false | toggle | Camera orbits around selected node or centroid |
| `geoInfluence` | 0.1 | 0-0.3 | Geo-attraction force strength (only shown when nodes have location data) |
| `animatePacketFlow` | true | toggle | Enable/disable packet path highlighting |
| `packetHighlightDurationMs` | 5000 | 500-15000 | Duration of each packet highlight |

## Graph rendering performance

- **GPU instancing**: All nodes in a single InstancedMesh draw call, all edges in a single LineSegments draw call — O(1) draw calls regardless of graph size.
- **Structural fingerprinting**: Node/edge topology changes are detected via sorted hash fingerprints. Packet-count-only updates skip D3 reheat and renderer topology rebuild.
- **Display fingerprinting**: Name/role/observer changes trigger lightweight `refreshMetadata()` instead of full rebuild.
- **No React setState per tick**: D3 simulation tick writes directly to typed arrays and InstancedMesh matrices.
- **Label caching**: Canvas-rendered Sprite labels are only rebuilt when text or size changes.
- **Packet highlight batching**: In-flight packet pruning runs on a 1.5s interval, not per-frame.

## WebSocket connection behavior

- URL auto-detection: dev mode (port 9001) targets `:3001/ws`, production uses same host with protocol upgrade
- Reconnect: exponential backoff from 1s to 30s cap
- On error: closes socket (triggers reconnect via close handler)
- Init message replaces all state; subsequent messages merge incrementally
- Packet log capped at 50 entries; debug log capped at 200

## Adding new features checklist

1. **New data from backend**: Add type to `types.ts`, handle in `useWebSocket.ts`, expose from hook
2. **New panel/component**: Create in `components/`, use Tailwind dark theme, wire in `App.tsx`
3. **New graph visual**: Modify `MeshRenderer.ts` (GPU rendering) and/or `NetworkGraph3DCustom.tsx` (simulation/data bridge)
4. **New viz setting**: Add to `GraphSettings` interface in `NetworkGraph3DCustom.tsx`, add control in `App.tsx`, update `DEFAULT_GRAPH_SETTINGS`
5. **New node detail**: Add field to `NodePanel.tsx` using the `Field` sub-component pattern
