# AGENTS.md (client)

Scope: `client/` — the React frontend.

## Frontend workflow

```bash
cd client
npm run dev                  # Vite dev server on http://localhost:5173
npm run build                # TypeScript check + Vite production build
npm run preview              # preview production build locally
```

The frontend is a standalone Vite+React app. In development, it runs on port 5173 and proxies WebSocket connections to the backend on port 3001. In production, it is served as static files by the Express backend from `client/dist`.

## Component hierarchy

```
App.tsx
  +-- StatsBar                 Top bar: connection status, counts, packet rate
  +-- NetworkGraph (2D)        D3 SVG force-directed graph (when mode === '2d')
  +-- NetworkGraph3D (3D)      react-force-graph-3d WebGL graph (when mode === '3d')
  +-- NodePanel                Side panel for selected node details + neighbours
  +-- PacketLog                Bottom bar showing recent packet activity
  +-- DebugPanel               Floating overlay for backend debug logs
  +-- RangeControl (inline)    Reusable range slider for viz settings
  +-- ToggleControl (inline)   Reusable checkbox toggle for viz settings
```

## Component guide

### `App.tsx` — Root component and state wiring

Orchestrates the entire UI. Manages top-level state:
- `selectedId` — currently selected node hash (drives NodePanel)
- `showDebug` — toggles the debug panel overlay
- `showVizControls` — toggles the visualization settings panel
- `graphSettings` — `GraphSettings` object controlling both 2D and 3D renderers

Computes packet rate from `recentPackets` (count within last 60 seconds).

WebSocket URL is auto-detected: port 5173 (Vite dev) connects to `ws://hostname:3001/ws`, otherwise uses `ws://host/ws`.

**When to modify**: Adding new panels, changing layout, or wiring new state from the WebSocket hook.

### `hooks/useWebSocket.ts` — WebSocket connection and state management

Custom React hook that manages the full client-side state:

**State managed**:
- `graph.nodes: NodeData[]` — all known nodes
- `graph.edges: EdgeData[]` — all known edges
- `stats: StatsData` — latest stats snapshot
- `recentPackets: PacketEvent[]` — last 50 packet events (FIFO)
- `debugLogs: DebugLogEntry[]` — last 200 debug log entries (FIFO)
- `connected: boolean` — WebSocket connection status

**Message handling** (switch on `msg.type`):
- `init` — replaces full graph state and stats (sent on connect)
- `node` — merges single node into state (upsert by `hash`)
- `edge` — merges single edge into state (upsert by `from_hash + to_hash`)
- `stats` — replaces stats
- `packet` — prepends to recent packets (capped at 50)
- `debug` — prepends to debug logs (capped at 200)

**Reconnect**: On close, reconnects after 3 seconds. On error, closes the socket (triggering the close handler).

**Merge functions**: `mergeNode()` and `mergeEdge()` perform immutable array updates — find existing by key, replace in-place or append.

**When to modify**: Handling new WebSocket message types, changing state shape, or adjusting reconnect behavior.

### `components/NetworkGraph.tsx` — 2D force-directed graph (D3)

SVG-based graph renderer using D3 force simulation.

**Key types**:
- `GraphSettings` — shared settings interface (exported, used by both 2D and 3D)
- `SimNode extends NodeData` — adds D3 simulation fields (`x`, `y`, `vx`, `vy`, `fx`, `fy`)
- `SimEdge extends EdgeData` — `source` and `target` resolve to `SimNode` references

**Force simulation**:
- `forceLink` — configurable distance and strength from settings
- `forceManyBody` — configurable charge strength (negative = repulsion)
- `forceCenter` — weak centering (strength 0.05)
- `forceCollide` — prevents node overlap (radius + 10px buffer)

**Node rendering** (SVG groups):
- `.glow` circle — selection highlight ring (yellow when selected)
- `.main` circle — filled with role color from `ROLE_COLORS`
- `.label` text — node name or uppercase hash, positioned above node
- `.badge` text — packet count, positioned below node

**Interactions**:
- Click node to select (stops event propagation)
- Click background to deselect
- Drag nodes (temporarily pins `fx`/`fy`, releases on drag end)
- Zoom and pan via D3 zoom behavior

**Position preservation**: Node positions are cached in `posRef` Map across data updates. New nodes spawn near center with small random offset. Topology and force changes trigger a gentle alpha restart with `setTimeout` cooldown.

**When to modify**: Changing node appearance, adding edge labels, custom forces, or interaction behavior.

### `components/NetworkGraph3D.tsx` — 3D force-directed graph

WebGL-based graph renderer using `react-force-graph-3d` (Three.js under the hood).

**Key behaviors**:
- Node identity preserved across updates via `nodeMapRef` and `linkMapRef` Maps (prevents unnecessary Three.js object recreation)
- Container size tracked via `ResizeObserver` for responsive rendering
- Node color: role color from `ROLE_COLORS`, yellow (`#fbbf24`) when selected
- Labels: `SpriteText` objects when `showLabels` is enabled
- Background matches app theme: `#030712`
- Force tuning: `cooldownTicks: 150`, `d3AlphaDecay: 0.03`, `d3VelocityDecay: 0.3`

**When to modify**: Changing 3D-specific rendering, adding custom geometries, or adjusting Three.js settings.

### `components/StatsBar.tsx` — Top statistics bar

Compact horizontal bar showing:
- MMV title
- Connection status indicator (green dot + "live" / red dot + "offline")
- Node count, named node count, edge count, advert count
- Packet rate per minute (only shown when > 0)
- MQTT broker address (right-aligned)

Uses the `Stat` sub-component for each metric (value + label pair).

**When to modify**: Adding new metrics or changing the status indicator behavior.

### `components/NodePanel.tsx` — Node detail side panel

Right-side panel shown when a node is selected. Displays:
- Node name (or "Node XX" fallback) with role color indicator
- Hash, role name, packet count, first/last seen timestamps
- Public key (if known from advert, displayed in a code block)
- Neighbour list (connected edges with direction arrows and packet counts)

Helper functions: `formatTime()` for timestamp display, `timeAgo()` for relative time.

**When to modify**: Adding new node fields, changing the detail layout, or making neighbours clickable.

### `components/PacketLog.tsx` — Packet activity log

Bottom bar showing the 50 most recent packet events in reverse chronological order. Each row shows: timestamp, packet type (color-coded), message hash, and hop count.

Packet type colors are defined in `TYPE_COLORS` map (e.g., Advert=emerald, Trace=yellow, TextMessage=blue).

**When to modify**: Adding new columns, changing the color scheme, or adjusting the max visible count.

### `components/DebugPanel.tsx` — Backend debug log overlay

Floating panel (fixed position, bottom-right) that displays backend log entries streamed over WebSocket. Shows logs in reverse chronological order with ISO timestamps and color-coded levels (info=gray, warn=yellow, error=red).

Auto-scrolls to bottom on new entries via `scrollIntoView`.

**When to modify**: Adding log filtering, search, or level toggles.

## Type system

All shared types are centralized in `client/src/types.ts`:

```typescript
interface NodeData {
  hash: string;              // 2-char hex, primary key
  public_key: string | null;
  name: string | null;
  device_role: number;       // DeviceRole enum (0-4)
  first_seen: number;        // unix ms
  last_seen: number;         // unix ms
  packet_count: number;
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
  packetType: string;
  hash: string;
  pathLen: number;
  path: string[];            // decoded hop sequence (2-char hex hashes)
  duration: number | null;   // packet transmission duration in ms (from envelope)
  receivedAt: number;        // added client-side
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
- **Accent colors**: `purple-500/600` for viz controls, `indigo-600` for debug toggle, `yellow-400` for selected state, role colors for node indicators
- **Graph background**: `#030712` (matches `bg-gray-950`)

## Graph settings (`GraphSettings`)

Shared between 2D and 3D renderers, controlled from App.tsx viz panel:

| Setting | Default | Range | Notes |
|---|---|---|---|
| `minNodeRadius` | 9 | 5-18 | Used as fixed node size in both modes |
| `maxNodeRadius` | 24 | 14-36 | 2D only (currently unused, reserved for scaling) |
| `linkDistance` | 120 | 60-220 | D3 force link distance |
| `linkStrength` | 0.5 | 0.1-1.0 | D3 force link strength |
| `chargeStrength` | -350 | -80 to -800 | D3 force many-body (negative = repulsion) |
| `showLabels` | true | toggle | Show node name/hash labels |
| `showPacketBadges` | true | toggle | 2D only: show packet count below nodes |
| `mode` | '3d' | '2d'/'3d' | Switches between D3 SVG and Three.js WebGL |
| `threeDLinkOpacity` | 0.55 | 0.1-1.0 | 3D only: link transparency |
| `threeDLabelSize` | 5 | 3-10 | 3D only: SpriteText height |

## Graph rendering performance

- **2D**: D3 simulation runs on every tick. Topology/force changes trigger a small alpha restart with `setTimeout` cooldown (500ms). Position map avoids node teleportation on data updates.
- **3D**: Object identity preserved via Maps to avoid Three.js recreation. `useMemo` recomputes graph data only when nodes, edges, or node size change.
- Both modes: avoid expensive operations per frame. Node data updates should be O(1) lookups, not full array scans where possible.

## WebSocket connection behavior

- URL auto-detection: dev mode (port 5173) targets `:3001/ws`, production uses same host
- Reconnect delay: 3 seconds after close
- On error: closes socket (triggers reconnect via close handler)
- Init message replaces all state; subsequent messages merge incrementally
- Packet log capped at 50 entries; debug log capped at 200

## Adding new features checklist

1. **New data from backend**: Add type to `types.ts`, handle in `useWebSocket.ts`, expose from hook
2. **New panel/component**: Create in `components/`, use Tailwind dark theme, wire in `App.tsx`
3. **New graph visual**: Modify `NetworkGraph.tsx` (2D) and/or `NetworkGraph3D.tsx` (3D)
4. **New viz setting**: Add to `GraphSettings` interface, add control in `App.tsx`, update `DEFAULT_GRAPH_SETTINGS`
5. **New node detail**: Add field to `NodePanel.tsx` using the `Field` sub-component pattern
