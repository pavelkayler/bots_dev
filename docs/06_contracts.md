# 06 Frontend ↔ Backend Contracts (REST + WS)

Last update: 2026-03-04

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
{ "sessionState": "STOPPED|RUNNING|STOPPING|PAUSING|PAUSED|RESUMING", "sessionId": "string|null", "eventsFile": "string|null", "runningSinceMs": "number|null", "runtimeMessage": "string|null" }
```

### POST /api/session/start
Starts a new runtime session (creates session folder and events log).

Response (success):
```json
{ "sessionState": "RUNNING", "sessionId": "2026-02-24T12-31-15-592Z", "eventsFile": "...", "runningSinceMs": 1760000000000 }
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

### GET /api/session/run-pack
Returns a run-pack manifest with URLs for events, summary, config snapshot, and universe snapshot.

### GET /api/session/run-pack/config/download
Downloads current config snapshot JSON.

### GET /api/session/run-pack/universe/download
Downloads current universe snapshot JSON.

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
Returns optimizer datasource status.

#### POST /api/optimizer/run
Starts an optimization job using selected dataset histories/cache.
Body:
```json
{
  "datasetHistoryIds": ["history-..."],
  "candidates": 200,
  "seed": 1,
  "ranges": {
    "tp": { "min": 2, "max": 12 },
    "sl": { "min": 2, "max": 12 }
  },
  "precision": { "tp": 0, "sl": 0, "offset": 3 }
}
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
- `tick` (coalesced rows update while RUNNING, flushed up to 10Hz)
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
  - includes persisted `progress` snapshot: `{ jobId, status, runIndex, runTotal, runPct, overallPct, updatedAt }`

Health:
- `GET /api/doctor`
- `GET /api/soak/last`

### Optimizer execution model
- Heavy optimizer compute runs in a worker thread.
- Main thread updates job state from worker messages.
- Jobs/loops are persisted to disk with paused-safe recovery on backend restart.
- Optimizer runs are driven by dataset histories/cache only.

## API changes: historical dataset cache (implemented)

### Deprecated (planned removal)
- Tape endpoints have been removed. Optimizer runs are driven by dataset histories/cache only.

### New endpoints (planned)
Dataset target:
- `POST /api/dataset/target`
  - body: { universeId: string, rangePreset?: "24h"|"48h"|"1w"|"2w"|"4w"|"1mo", fromTs?: number, toTs?: number }
  - response: { ok: true, target: {...}, effectiveFromTs, effectiveToTs }
- `GET /api/dataset/target`
  - response: current active dataset target (if any)

Data receive (cache fill):
- `POST /api/dataset/receive`
  - body: { targetId?: string } (or implicit current target)
  - response: { jobId }
- `GET /api/dataset/receive/:jobId`
  - response: progress { pct, phase, fetched, total, etaSec, throttled, message? }

Cache stats:
- `GET /api/dataset/cache/stats`
  - response: per-symbol coverage summary for current target

Notes:
- All endpoints should remain localhost-safe where needed.
- Progress updates should be throttled (10–20 updates/sec max).


## (2026-03-02) Dataset Target

### GET `/api/dataset-target`
Returns the current persisted dataset target.

Response:
```json
{
  "datasetTarget": {
    "universeId": null,
    "range": { "kind": "preset", "preset": "24h" },
    "updatedAtMs": 0
  }
}
```

### POST `/api/dataset-target`
Validates, normalizes, persists, and returns the dataset target.

Response:
```json
{
  "datasetTarget": {
    "universeId": "top_10m_6pct",
    "range": { "kind": "manual", "startMs": 1709251200000, "endMs": 1709337600000 },
    "updatedAtMs": 1772400000000
  }
}
```

## 2026-03-02 — Data receive job (Bybit REST → cache)

### POST /api/data/receive
Starts a receive-data job using persisted dataset target (`/api/dataset-target`) by default.

Success response:
```json
{ "jobId": "2f25f17e-0cb4-42b3-9098-f2e0eddd67ce" }
```

Validation errors:
- `400 { "error": "universe_not_selected" }`
- `400 { "error": "invalid_range" }`

### GET /api/data/receive/:jobId
Returns receive-data job state and throttled progress.

Response:
```json
{
  "job": {
    "id": "2f25f17e-0cb4-42b3-9098-f2e0eddd67ce",
    "status": "running",
    "progress": {
      "pct": 37,
      "completedSteps": 102,
      "totalSteps": 276,
      "currentSymbol": "BTCUSDT",
      "message": "Receiving BTCUSDT"
    },
    "startedAtMs": 1762133005000
  }
}
```

Terminal error example:
```json
{
  "job": {
    "id": "2f25f17e-0cb4-42b3-9098-f2e0eddd67ce",
    "status": "error",
    "progress": { "pct": 12, "completedSteps": 33, "totalSteps": 276 },
    "startedAtMs": 1762133005000,
    "finishedAtMs": 1762133008000,
    "error": { "code": "receive_failed", "message": "..." }
  }
}
```

### POST /api/data/receive/:jobId/cancel
Best-effort cancellation request for an active receive-data job.

Response:
```json
{ "ok": true }
```
