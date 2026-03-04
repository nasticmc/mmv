import type { StatsData } from '../types';

interface Props {
  stats: StatsData;
  connected: boolean;
  packetRate: number;
  mqttDisplayName: string;
}

export function StatsBar({ stats, connected, packetRate, mqttDisplayName }: Props) {
  return (
    <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 font-mono shrink-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-gray-300 font-semibold tracking-wide">🕸 MMV</span>

        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-red-500'}`}
          />
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? 'live' : 'offline'}
          </span>
        </div>

        <Stat label="nodes" value={stats.nodeCount} />
        <Stat label="named" value={stats.namedNodeCount} />

        {packetRate > 0 && <Stat label="pkt/min" value={packetRate} color="text-yellow-400" />}
      </div>

      <div className="mt-1 text-[11px] text-gray-600 truncate" title={mqttDisplayName}>
        {mqttDisplayName}
      </div>
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
