# 06 Frontend ↔ Backend Contracts (REST + WS)

Last update: 2026-02-24

This document describes the contract the UI relies on.

## REST API

### GET /health
Response:
```json
{ "ok": true }
```

### GET /api/session/status
Response:
```json
{ "sessionState": "STOPPED|RUNNING|STOPPING", "sessionId": "string|null", "eventsFile": "string|null" }
```

### POST /api/session/start
Starts a new runtime session (creates session folder and events log).

Response (success):
```json
{ "sessionState": "RUNNING", "sessionId": "2026-02-24T12-31-15-592Z", "eventsFile": "..." }
```

### POST /api/session/stop
Stops session and force-closes paper positions/orders.

Response:
```json
{ "sessionState": "STOPPED", "sessionId": "string|null", "eventsFile": "string|null" }
```

### GET /api/config
Response:
```json
{ "config": { ...runtimeConfig } }
```

### POST /api/config
Patch update (validated on backend). Paper parameters apply on next Start.

Response:
```json
{ "config": { ...runtimeConfig }, "applied": { "universe": "no_change|streams_reconnect", "signals": true, "fundingCooldown": true, "paper": "next_session" } }
```

### GET /api/session/events/download
Downloads the current session `events.jsonl`.

### GET /api/session/summary
Returns computed summary for current session (when available).

### GET /api/session/summary/download
Downloads `summary.json`.

### Universe builder
- `GET /api/universes` → list saved universes meta
- `GET /api/universes/:id` → universe file (meta + symbols)
- `POST /api/universes/create` → compute from Bybit WS tickers and save (overwrite by name/id)

## WebSocket /ws

### Server → Client messages
- `hello`
- `snapshot` (full state)
- `tick` (1Hz rows update)
- `streams_state`
- `events_tail`
- `events_append`
- `error`

Snapshot payload includes:
- session state, session id
- streams state
- `rows: SymbolRow[]` (LiveRows table)
- optional: universe info and bot stats (if enabled by backend)

### Client → Server messages
- `events_tail_request { limit }`
- `rows_refresh_request { mode: "tick"|"snapshot" }`
- `streams_toggle_request`
- `streams_apply_subscriptions_request`
