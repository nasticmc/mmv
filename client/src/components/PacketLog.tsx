import type { PacketEvent } from '../types';

interface Props {
  packets: PacketEvent[];
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

export function PacketLog({ packets }: Props) {
  if (packets.length === 0) return null;

  return (
    <div className="h-28 bg-gray-900 border-t border-gray-800 overflow-y-auto font-mono text-xs shrink-0">
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
        </div>
      ))}
    </div>
  );
}
