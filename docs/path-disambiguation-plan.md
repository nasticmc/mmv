# Path disambiguation plan (1-byte today, 2-byte-ready)

## What Remote Terminal appears to do

In `Remote-Terminal-for-MeshCore`, the path utilities treat path parsing as `(hop_count, hash_size)` rather than assuming 1-byte hashes. They decode the packed path metadata byte and then split/validate path strings based on the hop width (`split_path_hex`, `decode_path_byte`).

That approach is the key enabler for clean migration to 2-byte paths: all downstream logic consumes normalized hop IDs without hard-coding 2-char chunks.

## Problem in MMV today

MMV currently uses a single `nodes.hash` key as the node identity, which is effectively 1 byte in current firmware. That caps unique addressable anonymous hops at 256 and causes collisions when multiple unknown repeaters share the same first byte.

## Proposed disambiguation strategy

Use **two identifiers**:

1. **`hop_id`**: the raw path hop token (1/2/3-byte hash, e.g. `ab`, `ab12`).
2. **`node_id`**: a display identity used in graph nodes/edges.

Rules:

- If a node is resolved (advert/public key known), use stable `node_id = pk:<public_key>`.
- If unresolved, create an ephemeral disambiguated ID:
  - `u:<hop_id>:<context>` where context is derived from local topology, for example:
    - previous hop + next hop + observer hash
    - optionally rolling counter if context is empty
- Maintain an alias map so when adverts arrive, matching unresolved nodes can be merged into resolved `pk:*` nodes.

### Suggested DB additions

- `nodes`
  - add `node_id TEXT PRIMARY KEY` (new canonical key)
  - keep `hop_id TEXT` (indexed, non-unique)
  - keep `public_key TEXT UNIQUE NULL`
- `edges`
  - use `(from_node_id, to_node_id)` primary key
- `node_aliases`
  - map transient IDs to canonical IDs for merge/audit (`alias_id -> node_id`)

### Merge heuristics when advert arrives

For an advert-derived `public_key`:

1. Compute `hop_id` from key prefix (1-byte now, configurable width later).
2. Candidate unresolved nodes: same `hop_id`, recent activity window, and neighborhood overlap.
3. If one strong candidate, remap edges from `u:*` to `pk:*` and archive alias.
4. If ambiguous, keep both (avoid destructive merge); UI can show potential duplicates.

## 2-byte migration readiness

- Introduce `PATH_HASH_BYTES` env (default `1`) for key-prefix derivation.
- Normalize decoded path hops as variable-width even-length hex (`2/4/6` chars).
- Avoid assumptions that hop IDs are always 2 chars in backend/frontend labels.
- Store hop width in packet events if useful for debugging (`pathHopBytes`).

## Rollout plan

1. Land parser/normalization support for variable hop width (safe, backward-compatible).
2. Add schema migration for `node_id`/`hop_id` split.
3. Update processor to emit unresolved disambiguated IDs.
4. Add advert-time merge + alias remap.
5. Frontend: display `name || short public key || hop_id` and show merge transitions.

