import { useState, useEffect, useRef } from 'react';
import { NetworkGraph } from './components/NetworkGraph';
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

export default function App() {
  const { nodes, edges, stats, recentPackets, debugLogs, connected } = useWebSocket(WS_URL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);

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
      <div className="flex flex-1 min-h-0">
        {/* Graph */}
        <NetworkGraph
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

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
