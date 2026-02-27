# 06 Frontend ↔ Backend Contracts (REST + WS)

Last update: 2026-02-25

> Note: project evolved after 2026-02-25. New/updated contracts are appended at the end of this file (2026-02-26).

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
{ "config": { "...": "runtimeConfig" } }
```

### POST /api/config
Patch update (validated/normalized on backend). Paper parameters apply on next Start.

Notable config fields:
- `klineTfMin: 1|3|5|15|30|60`
- `paper.directionMode: "both"|"long"|"short"` (default `"both"`)
- `signals.requireFundingSign` is **forced true** by backend normalization (UI does not expose toggle).

Response:
```json
{
  "config": { "...": "runtimeConfig" },
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

### Optimizer
See `docs/17_optimizer.md` for semantics.

#### GET /api/optimizer/status
Reports tape recorder status.
Response:
```json
{ "isRecording": true, "tapeId": "tape-2026-02-25T11-15-26-635Z" }
```

#### GET /api/optimizer/settings
Response:
```json
{ "tapesDir": "...server filesystem path..." }
```

#### POST /api/optimizer/settings
Body:
```json
{ "tapesDir": "...server filesystem path..." }
```
Response:
```json
{ "tapesDir": "..." }
```

#### GET /api/optimizer/tapes
Response:
```json
{
  "tapes": [
    {
      "id": "tape-...",
      "createdAt": "2026-02-25T...Z",
      "fileSizeBytes": 12345,
      "meta": { "klineTfMin": 1, "symbolsCount": 337 }
    }
  ]
}
```

#### POST /api/optimizer/tapes/start
Starts tape recording (RUNNING only).
- Returns `409` if session is not RUNNING.

Response:
```json
{ "tapeId": "tape-..." }
```

#### POST /api/optimizer/tapes/stop
Response:
```json
{ "ok": true }
```

#### POST /api/optimizer/run
Starts an optimization job.
Body (preferred multi-tape):
```json
{
  "tapeIds": ["tape-...", "tape-..."],
  "candidates": 200,
  "seed": 1,
  "ranges": {
    "tp": { "min": 2, "max": 12 },
    "sl": { "min": 2, "max": 12 }
  },
  "precision": { "tp": 0, "sl": 0, "offset": 3 }
}
```
Legacy (single tape):
```json
{ "tapeId": "tape-...", "candidates": 200, "seed": 1 }
```
Response:
```json
{ "jobId": "job-..." }
```

#### GET /api/optimizer/jobs/current
Returns the newest running job if any, else the latest finished job, else null.
Response:
```json
{ "jobId": "job-..." }
```

#### GET /api/optimizer/jobs/:jobId/status
Response:
```json
{ "status": "running|done|error", "total": 100, "done": 37, "message": "...optional..." }
```

#### GET /api/optimizer/jobs/:jobId/results
Query:
- `page` (1-based)
- `sortKey`: `netPnl|trades|winRatePct|priceTh|oivTh|tp|sl|offset`
- `sortDir`: `asc|desc`

Response:
```json
{
  "status": "done",
  "page": 1,
  "pageSize": 50,
  "totalRows": 50,
  "sortKey": "netPnl",
  "sortDir": "desc",
  "results": [
    {
      "rank": 1,
      "netPnl": 5.38,
      "trades": 18,
      "winRatePct": 22.22,
      "priceTh": 0.5,
      "oivTh": 1.0,
      "tp": 9,
      "sl": 10,
      "offset": 0.001
    }
  ]
}
```

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

---

## Addendum (2026-02-26)

### Session states
Runtime session states now include manual pause/resume:
- `RUNNING`, `STOPPING`, `STOPPED`
- `PAUSING`, `PAUSED`, `RESUMING`

Contract:
- Upstream Bybit WS is connected **only** in `RUNNING`.
- In `STOPPING/STOPPED/PAUSED`: upstream closed, timers cancelled, `rows=[]`.

### REST additions
Session:
- `POST /api/session/pause`
- `POST /api/session/resume`

Optimizer (job):
- `POST /api/optimizer/jobs/current/pause`
- `POST /api/optimizer/jobs/current/resume`
- `POST /api/optimizer/jobs/current/cancel`

Optimizer (loop):
- `POST /api/optimizer/loop/start`
- `POST /api/optimizer/loop/pause`
- `POST /api/optimizer/loop/resume`
- `POST /api/optimizer/loop/stop`
- `GET /api/optimizer/loop/status`

Health:
- `GET /api/doctor`
- `GET /api/soak/last`

### Optimizer execution model
- Heavy optimizer compute runs in a worker thread.
- Main thread updates job state from worker messages.
- Jobs/loops are persisted to disk with paused-safe recovery on backend restart.
- Tape recording is automatic on entering RUNNING and rotates at 90MB segments.
