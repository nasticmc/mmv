# AGENTS.md (backend)

Scope: `src/`

## Backend workflow

```bash
npm run dev:server
npm run build:server
```

## Processing and persistence rules

- Route all SQLite writes through `src/db.ts` exported helpers.
- In `src/processor.ts`, maintain clear phase ordering:
  1. Decode/validate packet
  2. Apply path-derived nodes/edges
  3. Apply payload-specific enrichment (e.g., advert)
  4. Apply observer-link logic
- Avoid emitting duplicate node/edge updates in a single packet pass.
- Keep hash normalization (`lowercase`) consistent.

## Reliability

- Prefer guard clauses for invalid input.
- If decoder behavior is uncertain, fail closed (return `null`) rather than emitting partial invalid topology.

