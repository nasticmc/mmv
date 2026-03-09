/**
 * Normalize a MeshCore key-ish string into a lowercase hex-only value.
 * Accepts values like `0xABCD...`, mixed-case hex, or already-clean strings.
 */
export function normalizeHexPrefix(value: string): string {
  return value
    .trim()
    .replace(/^0x/i, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();
}

function normalizePathHashBytes(bytes: number): number {
  const normalized = Number.isInteger(bytes) ? bytes : 1;
  return Math.min(3, Math.max(1, normalized));
}

const DEFAULT_PATH_HASH_BYTES = normalizePathHashBytes(parseInt(process.env.PATH_HASH_BYTES ?? '1', 10));

/**
 * MeshCore path hash = first byte (2 hex chars) of the node public key/prefix.
 */
export function hashFromKeyPrefix(value: string): string | null {
  return hashFromKeyPrefixWithBytes(value, DEFAULT_PATH_HASH_BYTES);
}

/**
 * Derive a path-hop identifier from a public key/prefix using a specific byte width.
 */
export function hashFromKeyPrefixWithBytes(value: string, bytes: number): string | null {
  const normalized = normalizeHexPrefix(value);
  const hexChars = normalizePathHashBytes(bytes) * 2;
  if (normalized.length < hexChars) return null;
  return normalized.slice(0, hexChars);
}

/**
 * Normalize decoded hop values to canonical lowercase even-length hex.
 */
export function normalizePathHop(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    if (value <= 0xff) return value.toString(16).padStart(2, '0');
    if (value <= 0xffff) return value.toString(16).padStart(4, '0');
    if (value <= 0xffffff) return value.toString(16).padStart(6, '0');
    return null;
  }

  if (typeof value !== 'string') return null;

  const cleaned = normalizeHexPrefix(value);
  if (cleaned.length < 2 || cleaned.length % 2 !== 0 || cleaned.length > 6) return null;
  return cleaned;
}
