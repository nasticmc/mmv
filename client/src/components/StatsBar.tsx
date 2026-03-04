import type { StatsData } from '../types';

interface Props {
  stats: StatsData;
  connected: boolean;
  packetRate: number;
  mqttDisplayName: string;
}

export function StatsBar({ stats, connected, packetRate, mqttDisplayName }: Props) {
  return (
    <div className="flex items-center gap-6 px-4 py-2 bg-gray-900 border-b border-gray-800 text-sm font-mono shrink-0">
      {/* Title */}
      <span className="text-gray-300 font-semibold tracking-wide">🕸 MMV</span>

      {/* MQTT status */}
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-red-500'}`}
        />
        <span className={connected ? 'text-green-400' : 'text-red-400'}>
          {connected ? 'live' : 'offline'}
        </span>
      </div>

      <div className="w-px h-4 bg-gray-700" />

      <Stat label="nodes" value={stats.nodeCount} />
      <Stat label="named" value={stats.namedNodeCount} />
      <Stat label="edges" value={stats.edgeCount} />
      <Stat label="adverts" value={stats.advertCount} />

      {packetRate > 0 && (
        <>
          <div className="w-px h-4 bg-gray-700" />
          <Stat label="pkt/min" value={packetRate} color="text-yellow-400" />
        </>
      )}

      <div className="ml-auto text-gray-600 text-xs">{mqttDisplayName}</div>
    </div>
  );
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={`text-base font-bold ${color}`}>{value}</span>
      <span className="text-gray-500 text-xs">{label}</span>
    </div>
  );
}
