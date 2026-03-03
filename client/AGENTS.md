# AGENTS.md (client)

Scope: `client/`

## Frontend workflow

```bash
cd client
npm run dev
npm run build
```

## UI conventions

- Maintain current visual language: dark theme, compact telemetry-oriented UI.
- Prefer incremental component changes over replacing existing graph logic.
- Keep types centralized in `client/src/types.ts`.
- For WebSocket events, update `client/src/hooks/useWebSocket.ts` first, then consumers.

## Graph behavior

- Keep D3 simulation stable across updates (avoid unnecessary reinitialization).
- Preserve node selection behavior and panel interactions when adding features.

