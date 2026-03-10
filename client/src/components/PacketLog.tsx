import type { PacketEvent } from '../types';

interface Props {
  packets: PacketEvent[];
  fullHeight?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  Advert:      'text-emerald-400',
  Trace:       'text-yellow-400',
  GroupText:   'text-purple-400',
  TextMessage: 'text-blue-400',
  Path:        'text-cyan-400',
  Ack:         'text-gray-400',
  Control:     'text-orange-400',
  Request:     'text-pink-400',
  Response:    'text-rose-400',
};

export function PacketLog({ packets, fullHeight = false }: Props) {
  if (packets.length === 0) return null;

  return (
    <div className={`${fullHeight ? 'h-full' : 'h-28'} bg-gray-900 border-t border-gray-800 overflow-y-auto font-mono text-xs shrink-0`}>
      <div className="px-3 py-1 text-gray-600 sticky top-0 bg-gray-900 border-b border-gray-800">
        packet log
      </div>
      {packets.map((p, i) => (
        <div
          key={`${p.hash}-${p.receivedAt}-${i}`}
          className="flex items-center gap-3 px-3 py-0.5 hover:bg-gray-800 transition-colors"
        >
          <span className="text-gray-600 w-20 shrink-0">
            {new Date(p.receivedAt).toLocaleTimeString()}
          </span>
          <span className={`w-24 shrink-0 ${TYPE_COLORS[p.packetType] ?? 'text-gray-400'}`}>
            {p.packetType}
          </span>
          <span className="text-gray-500 truncate">{p.hash}</span>
          {p.pathLen > 0 && (
            <span className="text-gray-600 shrink-0">{p.pathLen} hop{p.pathLen !== 1 ? 's' : ''}</span>
          )}
          {p.rssi !== null && (
            <span className="text-amber-400 shrink-0">{p.rssi} dBm</span>
          )}
          {p.snr !== null && (
            <span className="text-lime-400 shrink-0">SNR {p.snr} dB</span>
          )}
          {p.score !== null && (
            <span className="text-sky-400 shrink-0">score {p.score}</span>
          )}
          {p.observerHash && (
            <span className="text-cyan-400 shrink-0">obs:{p.observerHash.toUpperCase()}</span>
          )}
        </div>
      ))}
    </div>
  );
}
