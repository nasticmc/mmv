import type { NodeData } from '../types';

export function projectGeo(
  nodes: NodeData[],
  scale = 400,
  center?: { lat: number; lng: number },
): Map<string, { x: number; y: number }> {
  type Located = NodeData & { latitude: number; longitude: number };
  const located = nodes.filter((n): n is Located => n.latitude != null && n.longitude != null);
  if (located.length === 0) return new Map();

  const lats = located.map((n) => n.latitude);
  const lons = located.map((n) => n.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const span = Math.max(maxLat - minLat, maxLon - minLon) || 1;

  const midLat = center?.lat ?? located.reduce((s, n) => s + n.latitude, 0) / located.length;
  const midLon = center?.lng ?? located.reduce((s, n) => s + n.longitude, 0) / located.length;

  const result = new Map<string, { x: number; y: number }>();
  for (const n of located) {
    result.set(n.hash, {
      x: ((n.longitude - midLon) / span) * scale,
      y: -((n.latitude - midLat) / span) * scale,
    });
  }
  return result;
}
