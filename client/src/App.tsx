import { useState, useEffect, useRef, useMemo } from 'react';
import { NetworkGraph3D, type GraphSettings } from './components/NetworkGraph3D';
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
const GRAPH_SETTINGS_KEY = 'meshcore-visualiser-graph-settings';
const MOBILE_TAB_KEY = 'meshcore-visualiser-mobile-tab';
const FOCUS_MODE_KEY = 'meshcore-visualiser-focus-mode';

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  minNodeRadius: 9,
  linkDistance: 120,
  linkStrength: 0.5,
  chargeStrength: -350,
  showLabels: true,
  threeDLinkOpacity: 0.55,
  threeDLabelSize: 6,
  orbit: false,
  geoInfluence: 0.05,
  animatePacketFlow: true,
  packetHighlightDurationMs: 5000,
  packetHighlightMode: 'fixed',
  packetObservationWindowMs: 300,
};

interface ConfigResponse {
  mqttDisplayName: string;
  geoEnabled: boolean;
  geoCenter: { lat: number; lng: number } | null;
}

type MobileTab = 'visualizer' | 'packets';

function loadStoredGraphSettings(): GraphSettings {
  try {
    const raw = localStorage.getItem(GRAPH_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_GRAPH_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GraphSettings>;
    return {
      ...DEFAULT_GRAPH_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_GRAPH_SETTINGS };
  }
}

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showVizControls, setShowVizControls] = useState(false);
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(() => loadStoredGraphSettings());
  const [mobileTab, setMobileTab] = useState<MobileTab>(() => {
    const stored = localStorage.getItem(MOBILE_TAB_KEY);
    return stored === 'packets' ? 'packets' : 'visualizer';
  });
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem(FOCUS_MODE_KEY) === 'true');
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 768);

  const isLikelyMobile = useMemo(
    () => window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900,
    [],
  );

  const packetFlowSettings = useMemo(() => ({
    enabled: graphSettings.animatePacketFlow,
    highlightDurationMs: graphSettings.packetHighlightDurationMs,
    highlightMode: graphSettings.packetHighlightMode,
    observationWindowMs: graphSettings.packetObservationWindowMs,
    maxInFlightPackets: isLikelyMobile ? 24 : 80,
  }), [
    graphSettings.animatePacketFlow,
    graphSettings.packetHighlightDurationMs,
    graphSettings.packetHighlightMode,
    graphSettings.packetObservationWindowMs,
    isLikelyMobile,
  ]);

  const { nodes, edges, stats, recentPackets, inFlightPackets, packetRatePerMinute, connected } = useWebSocket(WS_URL, packetFlowSettings);
  const [mqttDisplayName, setMqttDisplayName] = useState('…');
  const [geoEnabled, setGeoEnabled] = useState(true);
  const [geoCenter, setGeoCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((r) => r.json())
      .then((d: ConfigResponse) => {
        setMqttDisplayName(d.mqttDisplayName);
        setGeoEnabled(d.geoEnabled);
        if (d.geoCenter) setGeoCenter(d.geoCenter);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(GRAPH_SETTINGS_KEY, JSON.stringify(graphSettings));
  }, [graphSettings]);

  useEffect(() => {
    localStorage.setItem(MOBILE_TAB_KEY, mobileTab);
  }, [mobileTab]);

  useEffect(() => {
    localStorage.setItem(FOCUS_MODE_KEY, String(focusMode));
  }, [focusMode]);

  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f') return;
      if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
      setFocusMode((prev) => !prev);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
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
    setPanelOpen(hash !== null && !isMobileViewport);
  };

  const applyPacketPreset = (preset: 'responsive' | 'balanced' | 'battery') => {
    setGraphSettings((prev) => {
      if (preset === 'responsive') {
        return { ...prev, packetObservationWindowMs: 50, packetHighlightDurationMs: 2500, packetHighlightMode: 'fixed' };
      }
      if (preset === 'battery') {
        return { ...prev, packetObservationWindowMs: 800, packetHighlightDurationMs: 7000, packetHighlightMode: 'fixed', showLabels: false };
      }
      return { ...prev, packetObservationWindowMs: 300, packetHighlightDurationMs: 5000 };
    });
  };

  const renderGraph = () => (
    <>
      <NetworkGraph3D
        nodes={effectiveNodes}
        edges={edges}
        selectedId={selectedId}
        onSelect={handleSelect}
        settings={graphSettings}
        focusNodeId={focusNodeId}
        focusKey={focusKey}
        geoCenter={geoCenter}
        inFlightPackets={inFlightPackets}
      />

      {!focusMode && (
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
      )}

      <div className="absolute top-3 left-3 z-30">
        <div className="flex gap-2">
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
          <button
            onClick={() => setFocusMode((v) => !v)}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold shadow-lg transition-colors ${
              focusMode
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-gray-800/90 hover:bg-gray-700 text-gray-200 border border-gray-600'
            }`}
            title="Toggle focus mode (hotkey: f)"
          >
            {focusMode ? 'Focus mode on' : 'Focus mode'}
          </button>
        </div>

        {showVizControls && (
          <div className="mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[calc(100vh-11rem)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900/95 backdrop-blur p-3 text-xs font-mono space-y-3 shadow-2xl md:w-72 md:max-h-[calc(100vh-8rem)]">
            <>
              <div className="text-gray-300 font-semibold">Display</div>
              <RangeControl label={`Node size: ${graphSettings.minNodeRadius}`} min={5} max={18} step={1} value={graphSettings.minNodeRadius} onChange={(v) => setGraphSettings((s) => ({ ...s, minNodeRadius: v }))} />
              <RangeControl label={`Label size: ${graphSettings.threeDLabelSize}`} min={3} max={12} step={0.5} value={graphSettings.threeDLabelSize} onChange={(v) => setGraphSettings((s) => ({ ...s, threeDLabelSize: v }))} />
              <RangeControl label={`Link opacity: ${graphSettings.threeDLinkOpacity.toFixed(2)}`} min={0.1} max={1} step={0.05} value={graphSettings.threeDLinkOpacity} onChange={(v) => setGraphSettings((s) => ({ ...s, threeDLinkOpacity: v }))} />
              <ToggleControl label="Show labels" checked={graphSettings.showLabels} onChange={(checked) => setGraphSettings((s) => ({ ...s, showLabels: checked }))} />

              <div className="pt-2 border-t border-gray-800 text-gray-300 font-semibold">Layout</div>
              <RangeControl label={`Link distance: ${graphSettings.linkDistance}`} min={60} max={220} step={5} value={graphSettings.linkDistance} onChange={(v) => setGraphSettings((s) => ({ ...s, linkDistance: v }))} />
              <RangeControl label={`Link strength: ${graphSettings.linkStrength.toFixed(2)}`} min={0.1} max={1} step={0.05} value={graphSettings.linkStrength} onChange={(v) => setGraphSettings((s) => ({ ...s, linkStrength: v }))} />
              <RangeControl label={`Repulsion: ${Math.round(Math.abs(graphSettings.chargeStrength))}`} min={80} max={800} step={10} value={Math.abs(graphSettings.chargeStrength)} onChange={(v) => setGraphSettings((s) => ({ ...s, chargeStrength: -v }))} />
              <ToggleControl label="Orbit mode" checked={graphSettings.orbit} onChange={(checked) => setGraphSettings((s) => ({ ...s, orbit: checked }))} />
              {hasGeoNodes && <RangeControl label={`Geo influence: ${graphSettings.geoInfluence.toFixed(2)}`} min={0} max={0.3} step={0.01} value={graphSettings.geoInfluence} onChange={(v) => setGraphSettings((s) => ({ ...s, geoInfluence: v }))} />}

              <div className="pt-2 border-t border-gray-800 text-gray-300 font-semibold">Packet animation</div>
              <ToggleControl label="Animate packet flow" checked={graphSettings.animatePacketFlow} onChange={(checked) => setGraphSettings((s) => ({ ...s, animatePacketFlow: checked }))} />
              <div className="text-[11px] leading-snug text-gray-500">Shorter batch windows feel faster but cost more CPU. Longer windows smooth bursts and reduce mobile jank.</div>
              <div className="flex gap-2">
                <button className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700" onClick={() => applyPacketPreset('responsive')}>Responsive</button>
                <button className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700" onClick={() => applyPacketPreset('balanced')}>Balanced</button>
                <button className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700" onClick={() => applyPacketPreset('battery')}>Battery</button>
              </div>
              <RangeControl
                label={`Packet highlight (ms): ${graphSettings.packetHighlightDurationMs}`}
                min={500}
                max={15000}
                step={100}
                value={graphSettings.packetHighlightDurationMs}
                onChange={(v) => setGraphSettings((s) => ({ ...s, packetHighlightDurationMs: v }))}
                disabled={!graphSettings.animatePacketFlow || graphSettings.packetHighlightMode === 'packetDuration'}
              />
              <SelectControl
                label="Packet highlight timing"
                value={graphSettings.packetHighlightMode}
                onChange={(value) => setGraphSettings((s) => ({ ...s, packetHighlightMode: value }))}
                options={[
                  { value: 'fixed', label: 'Fixed duration' },
                  { value: 'packetDuration', label: 'Use packet duration' },
                ]}
                disabled={!graphSettings.animatePacketFlow}
              />
              <RangeControl
                label={`Packet batch window (ms): ${graphSettings.packetObservationWindowMs}`}
                min={0}
                max={1200}
                step={50}
                value={graphSettings.packetObservationWindowMs}
                onChange={(v) => setGraphSettings((s) => ({ ...s, packetObservationWindowMs: v }))}
                disabled={!graphSettings.animatePacketFlow}
              />

              <button
                onClick={() => setGraphSettings(() => ({ ...DEFAULT_GRAPH_SETTINGS }))}
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700"
              >
                Reset defaults
              </button>
            </>
          </div>
        )}
      </div>

      {selectedNode && panelOpen && (
        isMobileViewport ? (
          <div className="absolute inset-x-0 bottom-0 z-40 max-h-[55vh] [&>div]:w-full [&>div]:border-l-0 [&>div]:border-t [&>div]:border-gray-800">
            <NodePanel node={selectedNode} edges={edges} onClose={() => setPanelOpen(false)} />
          </div>
        ) : (
          <div className="absolute inset-y-0 right-0 z-40">
            <NodePanel node={selectedNode} edges={edges} onClose={() => setPanelOpen(false)} />
          </div>
        )
      )}

      {selectedNode && !panelOpen && (
        <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/95 backdrop-blur px-3 py-2 text-xs font-mono shadow-xl">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedNode.is_observer ? '#22d3ee' : (ROLE_COLORS[selectedNode.device_role] ?? ROLE_COLORS[0]) }} />
          <span className="text-gray-100 max-w-[140px] truncate">{selectedNode.name ?? selectedNode.hash.toUpperCase()}</span>
          <button onClick={() => setPanelOpen(true)} className="text-purple-400 hover:text-purple-300 transition-colors ml-1" title="View details">↗</button>
          <button onClick={() => handleSelect(null)} className="text-gray-500 hover:text-gray-300 transition-colors text-base leading-none ml-0.5" title="Clear selection">×</button>
        </div>
      )}
    </>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-950 text-gray-100">
      <StatsBar stats={stats} connected={connected} packetRate={packetRatePerMinute} mqttDisplayName={mqttDisplayName} />

      {isMobileViewport ? (
        <>
          <div className="flex gap-2 px-3 pt-2">
            <button className={`flex-1 rounded border px-2 py-1 text-xs font-mono ${mobileTab === 'visualizer' ? 'border-purple-500 bg-purple-600 text-white' : 'border-gray-700 bg-gray-900 text-gray-300'}`} onClick={() => setMobileTab('visualizer')}>Visualizer</button>
            <button className={`flex-1 rounded border px-2 py-1 text-xs font-mono ${mobileTab === 'packets' ? 'border-purple-500 bg-purple-600 text-white' : 'border-gray-700 bg-gray-900 text-gray-300'}`} onClick={() => setMobileTab('packets')}>Packet log</button>
          </div>
          <div className="flex flex-1 min-h-0 relative">
            {mobileTab === 'visualizer' ? (
              renderGraph()
            ) : (
              <PacketLog packets={recentPackets} fullHeight />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-1 min-h-0 relative">
            {renderGraph()}
          </div>
          {!focusMode && <PacketLog packets={recentPackets} />}
        </>
      )}

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


interface SelectControlProps {
  label: string;
  value: 'fixed' | 'packetDuration';
  onChange: (value: 'fixed' | 'packetDuration') => void;
  options: Array<{ value: 'fixed' | 'packetDuration'; label: string }>;
  disabled?: boolean;
}

function SelectControl({ label, value, onChange, options, disabled = false }: SelectControlProps) {
  return (
    <label className={`block space-y-1 ${disabled ? 'opacity-50' : ''}`}>
      <div className="text-gray-300">{label}</div>
      <select
        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as 'fixed' | 'packetDuration')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
