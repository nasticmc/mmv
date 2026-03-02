import type { NodeData, EdgeData } from '../types';
import { ROLE_NAMES, ROLE_COLORS } from '../types';

interface Props {
  node: NodeData | null;
  edges: EdgeData[];
  onClose: () => void;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function timeAgo(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function NodePanel({ node, edges, onClose }: Props) {
  if (!node) return null;

  const roleColor = ROLE_COLORS[node.device_role] ?? ROLE_COLORS[0];
  const roleName = ROLE_NAMES[node.device_role] ?? 'Unknown';

  // Edges connected to this node
  const connected = edges.filter(
    e => e.from_hash === node.hash || e.to_hash === node.hash
  );

  const neighbours = connected.map(e =>
    e.from_hash === node.hash ? e.to_hash : e.from_hash
  );

  return (
    <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col shrink-0 font-mono text-sm overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: roleColor, boxShadow: `0 0 8px ${roleColor}` }}
          />
          <span className="text-white font-semibold truncate">
            {node.name ?? `Node ${node.hash.toUpperCase()}`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Details */}
      <div className="px-4 py-3 space-y-3 text-gray-300">
        <Field label="Hash" value={node.hash.toUpperCase()} mono />
        <Field label="Role" value={roleName} color={roleColor} />
        <Field label="Packets" value={String(node.packet_count)} />
        <Field label="First seen" value={formatTime(node.first_seen)} />
        <Field label="Last seen" value={`${formatTime(node.last_seen)} (${timeAgo(node.last_seen)})`} />

        {node.public_key && (
          <div>
            <div className="text-gray-500 text-xs mb-1">Public key</div>
            <div className="text-gray-400 text-xs break-all bg-gray-800 rounded px-2 py-1.5 leading-relaxed">
              {node.public_key}
            </div>
          </div>
        )}

        {/* Neighbours */}
        {neighbours.length > 0 && (
          <div>
            <div className="text-gray-500 text-xs mb-1.5">
              Neighbours ({neighbours.length})
            </div>
            <div className="space-y-1">
              {connected.map(e => {
                const peer = e.from_hash === node.hash ? e.to_hash : e.from_hash;
                const direction = e.from_hash === node.hash ? '→' : '←';
                return (
                  <div
                    key={`${e.from_hash}-${e.to_hash}`}
                    className="flex items-center justify-between bg-gray-800 rounded px-2 py-1"
                  >
                    <span className="text-gray-400 text-xs">{direction} {peer.toUpperCase()}</span>
                    <span className="text-gray-500 text-xs">{e.packet_count} pkts</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Location note */}
        <div className="text-gray-600 text-xs italic border-t border-gray-800 pt-3">
          Location data is stored but not used for graph positioning.
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 text-xs shrink-0">{label}</span>
      <span
        className={`text-xs truncate ${mono ? 'font-mono' : ''}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
