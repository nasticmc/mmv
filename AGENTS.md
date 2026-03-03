# AGENTS.md

This file provides guidance for coding agents working in this repository.
Its scope is the entire repo unless overridden by a deeper `AGENTS.md`.

## Project overview

MMV is a MeshCore network visualizer:
- Backend: Node.js + TypeScript (`src/`), MQTT ingest, SQLite persistence, WS broadcast
- Frontend: React + Vite + TypeScript + D3 (`client/src/`)
- Runtime data: SQLite DB at `data/mmv.db` by default

## Quick start

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

## Build and validation

Before finalizing a change, run:

```bash
npm run build
```

If backend logic changed, also sanity-check by running the server locally:

```bash
npm run dev:server
```

## Code change conventions

- Keep TypeScript strictness intact; avoid `any` unless absolutely necessary.
- Prefer small focused changes over broad refactors.
- Reuse existing helpers in `src/db.ts`, `src/processor.ts`, and `src/hash-utils.ts`.
- Preserve existing node/edge dedupe behavior in packet processing paths.
- Avoid introducing new dependencies unless required.
- Keep comments short and implementation-focused.

## Backend notes (`src/`)

- `src/processor.ts` is the topology truth point for packet → graph updates.
- `src/db.ts` should remain the only place with direct SQL mutations.
- Normalize hashes to lowercase before persistence/edge creation.
- Keep packet processing resilient: malformed packets should fail safely.

## Frontend notes (`client/src/`)

- Keep WebSocket message handling backward-compatible.
- Match existing UI style (Tailwind utility patterns already used in repo).
- Keep graph rendering performant (avoid expensive per-frame work).

## PR guidance for agents

- Explain **what changed** and **why**.
- Include exact validation commands run.
- If behavior changes in topology inference, include a concrete packet/path example.

