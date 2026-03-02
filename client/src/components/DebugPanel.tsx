import { useEffect, useRef } from 'react';
import type { DebugLogEntry } from '../types';

interface DebugPanelProps {
  logs: DebugLogEntry[];
  onClose: () => void;
}

const LEVEL_COLOR: Record<string, string> = {
  info:  'text-gray-300',
  warn:  'text-yellow-400',
  error: 'text-red-400',
};

function fmt(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, -1);
}

export function DebugPanel({ logs, onClose }: DebugPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="fixed bottom-0 right-0 w-full md:w-2/3 lg:w-1/2 h-64 bg-gray-900 border-t border-l border-gray-700 flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <span className="text-xs font-mono font-semibold text-gray-300 uppercase tracking-wider">
          Backend Debug Log
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-100 text-lg leading-none px-1"
          aria-label="Close debug panel"
        >
          ×
        </button>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
        {logs.length === 0 ? (
          <div className="text-gray-600 italic">No log entries yet…</div>
        ) : (
          [...logs].reverse().map((entry, i) => (
            <div key={i} className="flex gap-2 leading-snug">
              <span className="text-gray-600 shrink-0">{fmt(entry.ts)}</span>
              <span className={`shrink-0 uppercase ${LEVEL_COLOR[entry.level]}`}>
                [{entry.level}]
              </span>
              <span className="text-gray-200 break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
