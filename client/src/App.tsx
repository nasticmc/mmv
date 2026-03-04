import { useState, useEffect, useRef, useMemo } from 'react';
import { NetworkGraph, type GraphSettings } from './components/NetworkGraph';
import { NetworkGraph3D } from './components/NetworkGraph3D';
import { NodePanel } from './components/NodePanel';
import { StatsBar } from './components/StatsBar';
import { PacketLog } from './components/PacketLog';
import { useWebSocket } from './hooks/useWebSocket';
import type { NodeData } from './types';
import { ROLE_COLORS } from './types';

const isDev = window.location.port === '9001';
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = isDev
  ? `ws://${window.location.hostname}:3001/ws`
  : `${wsProtocol}//${window.location.host}/ws`;
const API_BASE = isDev ? `http://${window.location.hostname}:3001` : '';

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  minNodeRadius: 9,
  maxNodeRadius: 24,
  linkDistance: 120,
  linkStrength: 0.5,
  chargeStrength: -350,
  showLabels: true,
  showPacketBadges: true,
  mode: '3d',
  threeDLinkOpacity: 0.55,
  threeDLabelSize: 6,
  orbit: false,
  geoInfluence: 0.05,
  showPacketAnimation: true,
  maxRenderedPackets: 60,
};

interface ConfigResponse {
  mqttDisplayName: string;
  geoEnabled: boolean;
  geoCenter: { lat: number; lng: number } | null;
  packetAnimationEnabled: boolean;
  packetAnimationMax: number;
}

export default function App() {
  const { nodes, edges, stats, recentPackets, packetRatePerMinute, connected } = useWebSocket(WS_URL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showVizControls, setShowVizControls] = useState(false);
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const [mqttDisplayName, setMqttDisplayName] = useState('…');
  const [geoEnabled, setGeoEnabled] = useState(true);
  const [geoCenter, setGeoCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [packetAnimationEnabled, setPacketAnimationEnabled] = useState(true);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((r) => r.json())
      .then((d: ConfigResponse) => {
        setMqttDisplayName(d.mqttDisplayName);
        setGeoEnabled(d.geoEnabled);
        setPacketAnimationEnabled(d.packetAnimationEnabled);
        if (d.geoCenter) setGeoCenter(d.geoCenter);
        setGraphSettings((prev) => ({
          ...prev,
          showPacketAnimation: d.packetAnimationEnabled,
          maxRenderedPackets: d.packetAnimationMax,
        }));
      })
      .catch(() => {});
  }, []);

  const selectedNode: NodeData | null =
    selectedId != null ? (nodes.find((n) => n.hash === selectedId) ?? null) : null;

  const effectiveNodes = useMemo(
    () => (geoEnabled ? nodes : nodes.map((n) => ({ ...n, latitude: null, longitude: null }))),
    [nodes, geoEnabled],
  );

  const hasGeoNodes = effectiveNodes.some((n) => n.latitude != null);

  const handleSelect = (hash: string | null) => {
    setSelectedId(hash);
    setPanelOpen(hash !== null);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-950 text-gray-100">
      <StatsBar stats={stats} connected={connected} packetRate={packetRatePerMinute} mqttDisplayName={mqttDisplayName} />

      <div className="flex flex-1 min-h-0 relative">
        {graphSettings.mode === '3d' ? (
          <NetworkGraph3D
            nodes={effectiveNodes}
            edges={edges}
            selectedId={selectedId}
            onSelect={handleSelect}
            settings={graphSettings}
            focusNodeId={focusNodeId}
            focusKey={focusKey}
            geoCenter={geoCenter}
            recentPackets={recentPackets}
            packetAnimationEnabled={packetAnimationEnabled}
          />
        ) : (
          <NetworkGraph
            nodes={effectiveNodes}
            edges={edges}
            selectedId={selectedId}
            onSelect={handleSelect}
            settings={graphSettings}
            geoCenter={geoCenter}
            recentPackets={recentPackets}
            packetAnimationEnabled={packetAnimationEnabled}
          />
        )}

        <div className="absolute left-3 right-3 top-14 z-30 md:left-1/2 md:right-auto md:top-3 md:w-72 md:-translate-x-1/2">
          <NodeSearch
            nodes={nodes}
            onSelect={(hash) => {
              handleSelect(hash);
              setFocusNodeId(hash);
              setFocusKey((k) => k + 1);
            }}
          />
        </div>

        <div className="absolute top-3 left-3 z-30">
          <button
            onClick={() => setShowVizControls((v) => !v)}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold shadow-lg transition-colors ${
              showVizControls
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-gray-800/90 hover:bg-gray-700 text-gray-200 border border-gray-600'
            }`}
          >
            {showVizControls ? 'Hide settings' : 'Settings'}
          </button>

          {showVizControls && (
            <div className="mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[calc(100vh-11rem)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900/95 backdrop-blur p-3 text-xs font-mono space-y-3 shadow-2xl md:w-72 md:max-h-[calc(100vh-8rem)]">
              <ToggleControl
                label="3D mode"
                checked={graphSettings.mode === '3d'}
                onChange={(checked) => setGraphSettings((s) => ({ ...s, mode: checked ? '3d' : '2d' }))}
              />

              {graphSettings.mode === '3d' ? (
                <>
                  <div className="text-gray-300 font-semibold">3D controls</div>
                  <RangeControl label={`Node size: ${graphSettings.minNodeRadius}`} min={5} max={18} step={1} value={graphSettings.minNodeRadius} onChange={(v) => setGraphSettings((s) => ({ ...s, minNodeRadius: v }))} />
                  <RangeControl label={`Link distance: ${graphSettings.linkDistance}`} min={60} max={220} step={5} value={graphSettings.linkDistance} onChange={(v) => setGraphSettings((s) => ({ ...s, linkDistance: v }))} />
                  <RangeControl label={`Link strength: ${graphSettings.linkStrength.toFixed(2)}`} min={0.1} max={1} step={0.05} value={graphSettings.linkStrength} onChange={(v) => setGraphSettings((s) => ({ ...s, linkStrength: v }))} />
                  <RangeControl label={`Repulsion: ${Math.round(Math.abs(graphSettings.chargeStrength))}`} min={80} max={800} step={10} value={Math.abs(graphSettings.chargeStrength)} onChange={(v) => setGraphSettings((s) => ({ ...s, chargeStrength: -v }))} />
                  <RangeControl label={`Label size: ${graphSettings.threeDLabelSize.toFixed(1)}`} min={3} max={10} step={0.5} value={graphSettings.threeDLabelSize} onChange={(v) => setGraphSettings((s) => ({ ...s, threeDLabelSize: v }))} />
                  <RangeControl label={`Link opacity: ${graphSettings.threeDLinkOpacity.toFixed(2)}`} min={0.1} max={1} step={0.05} value={graphSettings.threeDLinkOpacity} onChange={(v) => setGraphSettings((s) => ({ ...s, threeDLinkOpacity: v }))} />
                  <ToggleControl label="Show labels" checked={graphSettings.showLabels} onChange={(checked) => setGraphSettings((s) => ({ ...s, showLabels: checked }))} />
                  <ToggleControl label="Orbit mode" checked={graphSettings.orbit} onChange={(checked) => setGraphSettings((s) => ({ ...s, orbit: checked }))} />
                  {hasGeoNodes && <RangeControl label={`Geo influence: ${graphSettings.geoInfluence.toFixed(2)}`} min={0} max={0.3} step={0.01} value={graphSettings.geoInfluence} onChange={(v) => setGraphSettings((s) => ({ ...s, geoInfluence: v }))} />}
                </>
              ) : (
                <>
                  <div className="text-gray-300 font-semibold">2D controls</div>
                  <RangeControl label={`Min radius: ${graphSettings.minNodeRadius}`} min={5} max={18} step={1} value={graphSettings.minNodeRadius} onChange={(v) => setGraphSettings((s) => ({ ...s, minNodeRadius: v }))} />
                  <RangeControl label={`Max radius: ${graphSettings.maxNodeRadius}`} min={14} max={36} step={1} value={graphSettings.maxNodeRadius} onChange={(v) => setGraphSettings((s) => ({ ...s, maxNodeRadius: Math.max(v, s.minNodeRadius + 2) }))} />
                  <RangeControl label={`Link distance: ${graphSettings.linkDistance}`} min={60} max={220} step={5} value={graphSettings.linkDistance} onChange={(v) => setGraphSettings((s) => ({ ...s, linkDistance: v }))} />
                  <RangeControl label={`Link strength: ${graphSettings.linkStrength.toFixed(2)}`} min={0.1} max={1} step={0.05} value={graphSettings.linkStrength} onChange={(v) => setGraphSettings((s) => ({ ...s, linkStrength: v }))} />
                  <RangeControl label={`Repulsion: ${Math.round(Math.abs(graphSettings.chargeStrength))}`} min={80} max={800} step={10} value={Math.abs(graphSettings.chargeStrength)} onChange={(v) => setGraphSettings((s) => ({ ...s, chargeStrength: -v }))} />
                  <ToggleControl label="Show labels" checked={graphSettings.showLabels} onChange={(checked) => setGraphSettings((s) => ({ ...s, showLabels: checked }))} />
                  <ToggleControl label="Show packet badges" checked={graphSettings.showPacketBadges} onChange={(checked) => setGraphSettings((s) => ({ ...s, showPacketBadges: checked }))} />
                  {hasGeoNodes && <RangeControl label={`Geo influence: ${graphSettings.geoInfluence.toFixed(2)}`} min={0} max={0.3} step={0.01} value={graphSettings.geoInfluence} onChange={(v) => setGraphSettings((s) => ({ ...s, geoInfluence: v }))} />}
                </>
              )}

              <div className="border-t border-gray-800 pt-3 space-y-3">
                <div className="text-gray-300 font-semibold">Packet animation</div>
                <ToggleControl
                  label="Enable packet animation"
                  checked={packetAnimationEnabled && graphSettings.showPacketAnimation}
                  onChange={(checked) => setGraphSettings((s) => ({ ...s, showPacketAnimation: checked }))}
                  disabled={!packetAnimationEnabled}
                />
                <RangeControl
                  label={`Max rendered packets: ${graphSettings.maxRenderedPackets}`}
                  min={10}
                  max={200}
                  step={5}
                  value={graphSettings.maxRenderedPackets}
                  onChange={(v) => setGraphSettings((s) => ({ ...s, maxRenderedPackets: Math.round(v) }))}
                  disabled={!packetAnimationEnabled || !graphSettings.showPacketAnimation}
                />
                {!packetAnimationEnabled && (
                  <div className="text-[11px] text-amber-400">Disabled by server config (PACKET_ANIMATION_ENABLED=false).</div>
                )}
              </div>

              <button
                onClick={() => setGraphSettings((s) => ({ ...DEFAULT_GRAPH_SETTINGS, showPacketAnimation: packetAnimationEnabled, maxRenderedPackets: s.maxRenderedPackets }))}
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700"
              >
                Reset defaults
              </button>
            </div>
          )}
        </div>

        {selectedNode && panelOpen && (
          <div className="absolute inset-y-0 right-0 z-40">
            <NodePanel node={selectedNode} edges={edges} onClose={() => setPanelOpen(false)} />
          </div>
        )}

        {selectedNode && !panelOpen && (
          <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/95 backdrop-blur px-3 py-2 text-xs font-mono shadow-xl">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ROLE_COLORS[selectedNode.device_role] ?? ROLE_COLORS[0] }} />
            <span className="text-gray-100 max-w-[140px] truncate">{selectedNode.name ?? selectedNode.hash.toUpperCase()}</span>
            <button onClick={() => setPanelOpen(true)} className="text-purple-400 hover:text-purple-300 transition-colors ml-1" title="View details">↗</button>
            <button onClick={() => handleSelect(null)} className="text-gray-500 hover:text-gray-300 transition-colors text-base leading-none ml-0.5" title="Clear selection">×</button>
          </div>
        )}
      </div>

      <PacketLog packets={recentPackets.slice(0, graphSettings.maxRenderedPackets)} />

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-600 font-mono">
            <div className="text-5xl mb-4">🕸️</div>
            <div className="text-lg font-semibold text-gray-500 mb-2">Waiting for nodes…</div>
            <div className="text-sm">
              {connected
                ? `Connected — listening for MeshCore packets on ${mqttDisplayName}`
                : 'Connecting to backend…'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface NodeSearchProps {
  nodes: NodeData[];
  onSelect: (hash: string) => void;
}

function NodeSearch({ nodes, onSelect }: NodeSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return nodes
      .filter((n) => n.name?.toLowerCase().startsWith(q) || n.hash.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [query, nodes]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        placeholder="Search nodes by name or prefix…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full rounded border border-gray-600 bg-gray-900/95 backdrop-blur px-3 py-1.5 text-xs font-mono text-gray-100 placeholder-gray-500 outline-none focus:border-purple-500 shadow-lg"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded border border-gray-700 bg-gray-900/98 shadow-2xl overflow-hidden z-50">
          {results.map((n) => (
            <button
              key={n.hash}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-mono hover:bg-gray-700 text-left"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(n.hash);
                setQuery(n.name ?? n.hash.toUpperCase());
                setOpen(false);
              }}
            >
              <span className="text-gray-100 truncate">{n.name ?? '—'}</span>
              <span className="text-gray-500 ml-2 shrink-0">{n.hash.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface RangeControlProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

function RangeControl({ label, min, max, step, value, onChange, disabled = false }: RangeControlProps) {
  return (
    <label className={`block space-y-1 ${disabled ? 'opacity-50' : ''}`}>
      <div className="text-gray-300">{label}</div>
      <input
        type="range"
        className="w-full accent-purple-500"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

interface ToggleControlProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function ToggleControl({ label, checked, onChange, disabled = false }: ToggleControlProps) {
  return (
    <label className={`flex items-center justify-between text-gray-300 ${disabled ? 'opacity-50' : ''}`}>
      <span>{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-purple-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
