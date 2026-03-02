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

/**
 * MeshCore path hash = first byte (2 hex chars) of the node public key/prefix.
 */
export function hashFromKeyPrefix(value: string): string | null {
  const normalized = normalizeHexPrefix(value);
  if (normalized.length < 2) return null;
  return normalized.slice(0, 2);
}
