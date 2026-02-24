# 06 Frontend ↔ Backend Contracts (REST + WS)

Last update: 2026-02-25

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
Patch update (validated/normalized on backend). Paper parameters apply on next Start.

Notable config fields:
- `klineTfMin: 1|3|5|15|30|60`
- `paper.directionMode: "both"|"long"|"short"` (default `"both"`)

Response:
```json
{
  "config": { ...runtimeConfig },
  "applied": { "universe": "no_change|streams_reconnect", "signals": true, "fundingCooldown": true, "paper": "next_session" }
}
```

### GET /api/session/events/download
Downloads the current session `events.jsonl`.

### GET /api/session/summary
Returns computed summary for current session (when available).

### GET /api/session/summary/download
Downloads `summary.json`.

### Universe builder / universes
- `GET /api/universes` → list saved universes meta
- `GET /api/universes/:id` → universe file (meta + symbols)
- `POST /api/universes/create` → compute from Bybit WS tickers and save (overwrite by name/id)
- `DELETE /api/universes/:id` → delete universe
  - returns `409` if the universe is currently selected and session is RUNNING/STOPPING

### Presets
- `GET /api/presets` → list presets meta
- `GET /api/presets/:id` → preset file (name + config)
- `PUT /api/presets/:id` → overwrite preset
- `DELETE /api/presets/:id` → delete preset

CORS note:
- API must allow DELETE from dev frontend origin (preflight OPTIONS).

## WebSocket `/ws`

### Server → Client messages
- `hello`
- `snapshot` (full state)
- `tick` (1Hz rows update while RUNNING)
- `streams_state`
- `events_tail`
- `events_append`
- `error`

Snapshot payload includes (high level):
- session state + session id
- streams state
- `rows: SymbolRow[]` (LiveRows table)
  - while STOPPED/STOPPING: `rows: []`
- `botStats` (aggregated; included in snapshot and tick)
- universe meta (selected universe + symbol count)

### Client → Server messages
- `events_tail_request { limit }` (limit up to 100; UI offers 5/25/50/100)
- `rows_refresh_request { mode: "tick"|"snapshot" }`

Legacy / internal (UI no longer exposes):
- `streams_toggle_request`
- `streams_apply_subscriptions_request`
