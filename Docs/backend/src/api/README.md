# Backend Session API + WS (dummy plumbing)

## Run locally

From repository root:

```bash
cd backend
npx tsc -p tsconfig.json
node dist/index.js
```

The server starts on `http://localhost:3000` by default.

## REST endpoints

- `POST /api/session/start`
  - Validates request body against `SessionStartRequest`.
  - Deterministic behavior: if a previous session is active, it is stopped first, then a new one starts.
  - Returns `{ ok, sessionId, state }`.
- `POST /api/session/stop`
  - Transitions state `STOPPING -> STOPPED`, stops tick loop.
  - Returns `{ ok, sessionId, state }`.
- `GET /api/session/status`
  - Returns `{ ok, sessionId, state, tfMin, counts, cooldown }`.

## WebSocket

- `GET /ws`
  - On connect sends:
    1. `hello`
    2. `snapshot`
  - While session is `RUNNING` / `COOLDOWN`, emits `tick` every 1000ms.
  - Emits `events_append` (dummy `EventRow`) and `session_state` on state changes.
