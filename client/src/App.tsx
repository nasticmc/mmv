import { useState, useEffect, useRef } from 'react';
import { NetworkGraph, type GraphSettings } from './components/NetworkGraph';
import { NetworkGraph3D } from './components/NetworkGraph3D';
import { NodePanel } from './components/NodePanel';
import { StatsBar } from './components/StatsBar';
import { PacketLog } from './components/PacketLog';
import { DebugPanel } from './components/DebugPanel';
import { useWebSocket } from './hooks/useWebSocket';
import type { NodeData } from './types';

const isDev = window.location.port === '5173';
const WS_URL = isDev
  ? `ws://${window.location.hostname}:3001/ws`
  : `ws://${window.location.host}/ws`;

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  minNodeRadius: 9,
  maxNodeRadius: 24,
  linkDistance: 120,
  linkStrength: 0.5,
  chargeStrength: -350,
  showLabels: true,
  showPacketBadges: true,
  mode: '3d',
};

export default function App() {
  const { nodes, edges, stats, recentPackets, debugLogs, connected } = useWebSocket(WS_URL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showVizControls, setShowVizControls] = useState(false);
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS);

  // Compute packet rate from recent packets
  const rateRef = useRef<number>(0);
  useEffect(() => {
    const oneMinuteAgo = Date.now() - 60_000;
    rateRef.current = recentPackets.filter((p) => p.receivedAt > oneMinuteAgo).length;
  });

  const selectedNode: NodeData | null =
    selectedId != null ? (nodes.find((n) => n.hash === selectedId) ?? null) : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-950 text-gray-100">
      {/* Top stats bar */}
      <StatsBar stats={stats} connected={connected} packetRate={rateRef.current} />

      {/* Main area */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Graph */}
        {graphSettings.mode === '3d' ? (
          <NetworkGraph3D
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            settings={graphSettings}
          />
        ) : (
          <NetworkGraph
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            settings={graphSettings}
          />
        )}

        {/* Visualization controls */}
        <div className="absolute top-3 left-3 z-30">
          <button
            onClick={() => setShowVizControls(v => !v)}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold shadow-lg transition-colors ${
              showVizControls
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-gray-800/90 hover:bg-gray-700 text-gray-200 border border-gray-600'
            }`}
          >
            {showVizControls ? 'Hide Viz Settings' : 'Viz Settings'}
          </button>

          {showVizControls && (
            <div className="mt-2 w-72 rounded-lg border border-gray-700 bg-gray-900/95 backdrop-blur p-3 text-xs font-mono space-y-3 shadow-2xl">
              <div className="text-gray-300 font-semibold">Node size is fixed for all nodes.</div>

              <RangeControl
                label={`Min radius: ${graphSettings.minNodeRadius}`}
                min={5}
                max={18}
                step={1}
                value={graphSettings.minNodeRadius}
                onChange={(v) => setGraphSettings(s => ({ ...s, minNodeRadius: v }))}
              />

              <RangeControl
                label={`Max radius: ${graphSettings.maxNodeRadius}`}
                min={14}
                max={36}
                step={1}
                value={graphSettings.maxNodeRadius}
                onChange={(v) => setGraphSettings(s => ({ ...s, maxNodeRadius: Math.max(v, s.minNodeRadius + 2) }))}
              />

              <RangeControl
                label={`Link distance: ${graphSettings.linkDistance}`}
                min={60}
                max={220}
                step={5}
                value={graphSettings.linkDistance}
                onChange={(v) => setGraphSettings(s => ({ ...s, linkDistance: v }))}
              />

              <RangeControl
                label={`Link strength: ${graphSettings.linkStrength.toFixed(2)}`}
                min={0.1}
                max={1}
                step={0.05}
                value={graphSettings.linkStrength}
                onChange={(v) => setGraphSettings(s => ({ ...s, linkStrength: v }))}
              />

              <RangeControl
                label={`Repulsion: ${Math.round(Math.abs(graphSettings.chargeStrength))}`}
                min={80}
                max={800}
                step={10}
                value={Math.abs(graphSettings.chargeStrength)}
                onChange={(v) => setGraphSettings(s => ({ ...s, chargeStrength: -v }))}
              />

              <ToggleControl
                label="3D mode"
                checked={graphSettings.mode === '3d'}
                onChange={(checked) => setGraphSettings(s => ({ ...s, mode: checked ? '3d' : '2d' }))}
              />

              <ToggleControl
                label="Show labels"
                checked={graphSettings.showLabels}
                onChange={(checked) => setGraphSettings(s => ({ ...s, showLabels: checked }))}
              />

              <ToggleControl
                label="Show packet badges"
                checked={graphSettings.showPacketBadges}
                onChange={(checked) => setGraphSettings(s => ({ ...s, showPacketBadges: checked }))}
              />

              <button
                onClick={() => setGraphSettings(DEFAULT_GRAPH_SETTINGS)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700"
              >
                Reset defaults
              </button>
            </div>
          )}
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <NodePanel
            node={selectedNode}
            edges={edges}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* Packet log */}
      <PacketLog packets={recentPackets} />

      {/* Debug toggle button */}
      <button
        onClick={() => setShowDebug(v => !v)}
        className={`fixed bottom-4 right-4 z-40 px-3 py-1.5 rounded text-xs font-mono font-semibold shadow-lg transition-colors ${
          showDebug
            ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
            : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
        }`}
      >
        {showDebug ? 'Hide Debug' : 'Debug'}
      </button>

      {/* Debug panel */}
      {showDebug && (
        <DebugPanel logs={debugLogs} onClose={() => setShowDebug(false)} />
      )}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-600 font-mono">
            <div className="text-5xl mb-4">🕸️</div>
            <div className="text-lg font-semibold text-gray-500 mb-2">Waiting for nodes…</div>
            <div className="text-sm">
              {connected
                ? 'Connected — listening for MeshCore packets on mqtt.eastmesh.au'
                : 'Connecting to backend…'}
            </div>
          </div>
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
}

function RangeControl({ label, min, max, step, value, onChange }: RangeControlProps) {
  return (
    <label className="block space-y-1">
      <div className="text-gray-300">{label}</div>
      <input
        type="range"
        className="w-full accent-purple-500"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

interface ToggleControlProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleControl({ label, checked, onChange }: ToggleControlProps) {
  return (
    <label className="flex items-center justify-between text-gray-300">
      <span>{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-purple-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
