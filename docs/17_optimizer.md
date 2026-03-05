# 17 Optimizer (cached REST dataset + search)

Last update: 2026-03-04

This document describes the Optimizer feature used to tune paper-trading parameters via cached historical market data and deterministic replay.

Tape-based optimizer inputs are removed. All optimizer runs use dataset histories/cache only.

## Goals
- Record market dataset histories (JSONL) while runtime session is **RUNNING**.
- Run random-search optimization over many parameter candidates on dataset history windows from cache.
- Keep backend responsive during heavy optimization (worker thread).
- Support long runs: pause/resume/cancel, checkpoints, and looped execution.

## Data and replay mechanics
- Price source: cached 1-minute klines from `backend/data/cache/bybit_klines/`.
- OI source: Bybit 5-minute OI is authoritative on its boundary points; CoinGlass is used only to fill missing in-between 1-minute OI slots for Bybit symbols during Receive Data.
- Funding source: `/v5/market/funding/history` point series from `backend/data/cache/bybit_funding_history/`; replay applies last-known funding value between timestamps.
- Execution replay supports two modes: default `closeOnly`, and optional `conservativeOhlc` for bar-range touch checks with worst-case tie resolution.
- Decision cadence is signal-window based: new entry decisions are evaluated only on `tf(opt)` window-close timestamps (`ts % tfMs === 0`).
- In-between 1m close ticks are execution-only: replay still calls broker tick processing each minute for fills/TP/SL/expiry, but does not generate new entry signals.
- `priceMovePct` and `oivMovePct` references are defined between consecutive signal-window closes (previous window close vs current window close), not per-minute bucket rollover values.
- `openInterestValue` uses `oi * close` only (no fabricated OI/OIV).
- Replay still emits one ticker per 1m candle close (no synthetic intermediate ticks). In conservative mode, each ticker additionally carries that candle OHLC so fill/TP/SL checks can use bar ranges without path simulation.
- Conservative worst-case policy: if TP and SL are both reachable in the same bar, SL is chosen so optimizer cannot gain optimistic sequencing advantages.
- PnL applies trading fees; funding fee is not applied in pnl. Funding is used only for direction gating.
- Unfinished positions at range end are excluded from optimizer stats.

## UI
Route: `/optimizer`

Main sections:
- Dataset histories list (cached data snapshots)
- Optimization inputs (candidates/seed/tf/direction + filters + loop controls)
- Progress (0.01% precision) + per-run elapsed/ETA + loop elapsed
- Results table (live incremental updates)

## Optimization run
### Core inputs
- `candidates`: how many candidates to evaluate
- `seed`: RNG seed (base seed)
- `directionMode`: `both | long | short`
- `signal window (min)` (tf(opt)): optimization signal/reference cadence window

### Filters
- `minTrades`: require at least N closed trades per candidate (server-side)
- `excludeNegative`: hide negative netPnl candidates from preview/final lists
- `rememberNegatives`: persist a per-runKey blacklist (skip previously negative candidates on next runs)

### Effective seed shifting (repeat runs)
When `rememberNegatives` is enabled:
- A persistent per-runKey `runIndex` is stored in the blacklist file.
- Each run uses:
  - `effectiveSeed = baseSeed + runIndex`
- runIndex increments on each run start for the same runKey.

### Run key
Blacklist and seed shifting are scoped by:
- selected cached dataset symbols/range
- directionMode
- tf(opt)

(runKey format is deterministic; stored in blacklist JSON. Candidate key includes directionMode, optTfMin, sim fields, and strategy params.)

### Job model
- Optimization runs as a job with:
  - progress `donePercent` in range 0.00..100.00
  - per-run elapsed + ETA (ETA disabled when not RUNNING)
  - pause/resume/cancel

### Worker thread
- Heavy replay executes in a **worker thread**.
- Main backend thread remains responsive to HTTP/WS.

### Incremental results + checkpoints
- Results are available incrementally during the run (preview top-K).
- Checkpoints are written to `backend/data/optimizer_checkpoints` using atomic writes.
- Retention is enforced (keeps a bounded number of recent checkpoint files).
- After backend restart, recovered job/loop state is surfaced as paused-safe (manual resume).

## Loop execution
Optimizer supports repeated runs:
- Run N times (`runsCount`)
- Or infinite loop until Stop

Loop state is persisted to disk and exposes:
- run index (i/N)
- loop elapsed

## Results table
- In loop mode: results are aggregated cumulatively (table grows/updates as runs find candidates).
- In single-run mode: table reflects the current run’s results (may clear at start only under explicit UI rule).

Each result row includes:
- netPnl, trades, winRate
- expectancy, profitFactor, max drawdown
- execution counters (placed/filled/expired)
- params (priceTh/oivTh/tp/sl/offset/timeoutSec/rearmMs)

## Copy to settings
- “Copy to settings” writes a pending patch to localStorage.
- Config page merges it into draft; operator applies manually.

## Health endpoints
- `GET /api/doctor` returns best-effort environment checks:
  - dataDir paths/writable
  - free bytes (best-effort)
  - warnings (e.g., low disk)
- `GET /api/soak/last` returns last soak snapshot cached in memory.

## Remote dataset cache (planned replacement for dataset histories)

The optimizer uses the Receive Data cache under `backend/data/cache/bybit_klines/`.
Instead, it will operate on a cached historical dataset fetched from Bybit REST history endpoints.

### Dataset Target
- **Universe**: selected symbol set.
- **Range**: preset (24h/48h/1w/2w/4w/1mo) or manual start/end.

### Workflow
1) Select Universe + Range.
2) Click **Receive Data** to apply the selected target and fill cache (fetch only missing parts).
4) Run optimizer in loop mode on cached points.

`klineTfMin` does **not** affect Universe naming and is unrelated to Universe file name/id semantics.

### UI simplification (planned)
- Remove single-run job controls (Run/Pause/Resume/Stop) and their backend job processes.
- Optimizer becomes loop-oriented (start/pause/resume/stop loop only), using the active dataset target.

### Rate limiting
Data receive must respect Bybit IP limits. Progress UI should show:
- requested symbols
- requested range
- fetched/total requests (or points)
- sleep/throttle periods due to limits

Current limiter target: strict 500 requests per 5 seconds.

## CoinGlass 1m OI gap-fill (implemented)

- Bybit remains the primary source for historical data and runtime data remains Bybit-only.
- CoinGlass is used only in Receive Data for historical Bybit OI minute gap fill.
- Scope is narrow:
  - OI only
  - 1-minute interval only
  - Bybit symbols only
  - no price/funding/other provider mixing
- Receive Data enforces strict completion: it does not finish successfully until all required 1m candles have OI values.
- CoinGlass Hobbyist throttle handling is built in (30 req/min window). When waiting, progress emits a reset countdown message.

## Receive Data QA + manifest

Each Receive Data run now writes a deterministic QA manifest tied to the dataset history row id.

- Manifest file path: `backend/data/cache/manifests/<historyId>.json`
- Dataset history API (`/api/data/history`) now includes a compact `manifest` summary block so UI can show quality state without loading the full manifest.

### What is validated
Per symbol, for the selected range:
- 1m kline expected vs present points, coverage %, missing contiguous windows, duplicate timestamps, out-of-order transitions, and SHA-256 hash.
- 5m Bybit open-interest points plus strict 1m candle-level OI completeness after CoinGlass gap fill.
- Funding history points present in range, min/max timestamp, missing expected 8h points, and SHA-256 hash of raw points.

### Status rules
- `ok`: every symbol has 100% 1m and 5m OI coverage, with zero duplicates and zero out-of-order points.
- `partial`: aggregate coverage is at least 95% but not all symbols are perfect.
- `bad`: aggregate coverage is below 95%, any symbol has below 90% on 1m or 5m OI, or duplicates/out-of-order issues are detected.

### Why this matters for optimizer trust
Optimizer replay still uses the same cache data, but now each Receive Data snapshot carries an auditable quality and integrity footprint. Operators can verify coverage and hashes before trusting loop results or comparing repeated runs over the same Universe+Range.

## Why optimizer is not “better than paper”
- Optimizer and paper share the same execution policy selected for the run: default close-only, or optional conservative OHLC with worst-case tie-breaking.
- Optimizer signal generation is intentionally throttled to signal-window closes only, matching policy and avoiding unrealistically frequent 1m entries.
- Funding gating remains the same (`requireFundingSign=true`, funding from history-aligned cache), so optimizer does not gain privileged directional information.

## Stability: Train/Validation time split

To reduce overfitting to a single contiguous range, each optimizer candidate is now evaluated with a deterministic time split of the selected dataset window:

- **Train** segment: first 70% of the selected time range.
- **Validation** segment: last 30% of the selected time range.
- Split timestamp is rounded down to a full minute boundary to avoid partial-minute edge effects.

Replay mechanics are unchanged for both segments:
- replay is bar-based: close-only by default, or conservative OHLC when enabled
- decisions only on signal-window closes (`ts % tfMs === 0`)
- `openInterestValue = oi * close`
- funding-direction gating from funding history
- unfinished positions excluded (`stopAll(closeOpenPositions: false)`)

Result rows now include train/validation stability metrics:
- `trainNetPnl`, `trainTrades`
- `valNetPnl`, `valTrades`
- `valPnlPerTrade`

Operator UI now includes display-only validation filters in the results toolbar:
- `val pnl/trade > 0`
- `val netPnl > 0`

These toggles are a quick stability lens for triage and do not change backend evaluation coverage. Candidates are still evaluated normally; filtering only affects which rows are shown in the table. A one-click preset button (`Sort: val pnl/trade`) also sets descending sort for faster validation-focused review.

Ranking remains based on existing overall metrics. Overall candidate totals are computed as **train + validation** aggregates (no separate third full-range replay pass).
