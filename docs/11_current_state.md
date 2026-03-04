# 11 Current State (what exists now) + Next Actions

Last update: 2026-03-04

## What the project is
A Bybit USDT‑perpetual bot skeleton focused on **operator-visible** paper testing and parameter iteration:
- Bybit public WS ingestion (tickers + kline refs)
- signal generation + reason codes
- paper execution (ROI-based TP/SL + maker fee; optional funding accounting)
- sessioned JSONL eventlog + summary
- operator UI (Dashboard + Universe Builder + Optimizer)

## Implemented (expected behavior)

### Sessions + logging
- REST:
  - `GET /api/session/status`
  - `POST /api/session/start`
  - `POST /api/session/stop`
  - `POST /api/session/pause`
  - `POST /api/session/resume`
  - `GET /api/session/summary` (+ download)
- Each session creates:
  - `backend/data/sessions/<sessionId>/events.jsonl`
  - `backend/data/sessions/<sessionId>/summary.json` (after stop)

### Streams lifecycle (important)
- Backend start flow enters `RESUMING` first, connects Bybit public WS, and transitions to `RUNNING` only after required streams are connected.
- On STOPPING/STOPPED/PAUSED:
  - upstream WS is closed
  - reconnect timers are cancelled
  - LiveRows `rows` are pushed as empty array (operator sees no tickers while stopped)

### Manual Pause/Resume (runtime)
- **Pause** is manual-only and is intended for “close laptop / no internet for a while”.
- Semantics:
  - `RUNNING -> PAUSING -> PAUSED`: upstream closed, timers cancelled, `rows=[]`.
  - `PAUSED -> RESUMING -> RUNNING`: cold re-subscribe to upstream + restart timers.

### Dashboard (operator view)
- Header shows:
  - CONNECTED (UI ↔ backend `/ws`)
  - Streams status (Bybit upstream)
  - Session status (RUNNING/STOPPING/STOPPED/PAUSING/PAUSED/RESUMING)
- WS connection is stable across client-side route changes (no reconnect on navigation).
- Live rows (1Hz) card:
  - Active only toggle + rows count
  - “Next candle in MM:SS” countdown (based on **draft** `klineTfMin`)
  - Refresh rows button (requests immediate tick update)
- Bot stats:
  - open/pending counts + pnl + closed trades + net realized + fees/funding
  - uptime next to RUNNING badge
- Trade stats by symbol (real-time):
  - includes 24h turnover and 24h volatility enrichment
  - includes Longs/Shorts (count/winrate)
  - sortable + paginated
- Events tail:
  - selectable limit (5/25/50/100)
  - download JSONL
- Summary:
  - resets on Start (new run)
  - loads on Stop
  - trades table supports global sort + pagination (50/100/200)

### Config + Presets
- Config is edited as **draft** and applied via **Apply**.
- Numeric inputs allow empty while typing; Apply validates and blocks if required fields are empty/invalid.
- Apply gating:
  - disabled if Universe not selected
  - disabled if draft == applied
  - disabled if invalid

**Note:** Apply-and-Run / Start-and-Record buttons were removed. Recording is automatic (see below).
- Presets:
  - selector + Save (overwrite) + Remove
  - option label includes timeframe: `... [tf=<klineTfMin>m]`
  - preset selection best-effort auto-selects Universe by matching the bracket token (e.g. `[10m/6%]`) to saved universe name
  - presets stored in `backend/data/presets/*.json`

### Funding sign gating (requireFundingSign)
- `signals.requireFundingSign` is forced **always true** (in backend normalization/migration/back-compat).
- UI control is removed.
- Trading direction is gated by funding sign:
  - fundingRate > 0 → allow LONG
  - fundingRate < 0 → allow SHORT

### Direction mode (paper)
- `paper.directionMode`: `"both" | "long" | "short"` (default `"both"`)
- Signal display + trading are both gated:
  - when mode blocks a direction, that signal is not shown and no trade is opened

### Universe Builder (/universe)
- Page uses the same standard header layout as other routes.
- Inputs:
  - min turnover 24h (USD)
  - min volatility 24h (%), defined as `(high-low)/low*100`
  - inputs allow empty while typing; Create validates
- Uses REST instruments-info only to seed valid USDT linear symbols.
- Uses WS tickers to compute turnover/volatility filters.
- Saves universes to `backend/data/universes/*.json`
- Delete button exists; deletion forbidden (409) if universe is in use by RUNNING/STOPPING session.

### Optimizer (/optimizer)
See `docs/17_optimizer.md`.
High-level:

- Optimizer dataset source:
  - data comes only from Receive Data cache + Dataset Target
  - price cache: `backend/data/cache/bybit_klines/` (1m candles)
  - OI cache: 5-minute grid (Bybit supports 5min/15min/...; minimum is 5min)
  - funding cache: `backend/data/cache/bybit_funding_history/` from `/v5/market/funding/history`, applied as last-known value between points

- Optimization:
  - job-based API with **pause/resume/cancel**
  - runs heavy compute in a **worker thread** (main server stays responsive)
  - progress is reported in percent and displayed in UI as integer 0..100
  - incremental preview results + checkpoints to disk + recovery to paused-safe state after restart
  - optional filters: `minTrades`, `excludeNegative`, `rememberNegatives` (persistent per-runKey blacklist)
  - remember-negatives skip is applied before simulation for matching candidate keys under the same runKey
  - effectiveSeed shifts per runKey runIndex when rememberNegatives is enabled
  - loop controller: run N times or infinite until stop

- Replay/PnL mechanics:
  - replay is close-only (no intra-candle OHLC extrema synthesis)
  - openInterestValue uses `oi * close` only; OI/OIV is not fabricated
  - fees are applied in pnl; funding fee is not applied in pnl (funding is direction gate only)
  - unfinished positions at range end are excluded from optimizer stats
  - `signal window (min)` (previously tf(opt)) controls signal/reference cadence, while execution uses close-only replay ticks

- Health:
  - `/api/doctor` shows disk/writable/ports warnings (incl. low disk)
  - soak snapshots written once per minute while RUNNING; `/api/soak/last` exposes last snapshot

## Known issues / tech debt (as of 2026-02-26)
- Local `npm run build` may fail due to unrelated pre-existing TypeScript typing issues.
- No automated tests yet (WS contract + config validation + paper broker).
- Frontend build may still fail due to unrelated historical TS issues; only fix when explicitly requested.

## Next actions (recommended)
1) Keep tightening stability guards: low-disk behavior, backpressure behavior, and long-run soak checks.
2) Add minimal CI: backend build always green; frontend build when TS debt is addressed.
3) Add lightweight automated tests for config normalization + worker message contract.

## Planned changes

### Historical dataset workflow
Optimizer consumes cached historical dataset built from Bybit REST history endpoints (Universe + Range + Receive Data).

### Remote historical dataset cache (planned)
New concept: **Dataset Target** = { Universe, Range }.
- Universe: selected pool of symbols (existing Universe builder logic remains, but selection becomes explicit for data fetch).
- Range: preset (24h/48h/1w/2w/4w/1mo) or manual start/end datetime.
Workflow:
1) User selects Universe + Range.
2) User presses **Receive Data** to apply the selected target and fetch missing historical points into the cache.
3) Optimizer loop runs on cached points. No repeated Bybit history queries per loop iteration.

`klineTfMin` does **not** affect Universe naming and is unrelated to Universe file name/id semantics.

Data fetch must be rate-limit aware (strict limit: 500 requests / 5 seconds) and provide progress/ETA.
