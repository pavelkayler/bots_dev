# 17 Optimizer (Tape recording + Replay search)

Last update: 2026-02-26

This document describes the Optimizer feature used to tune paper-trading parameters via recorded market “tapes” and deterministic replay.

## Goals
- Record market tapes (JSONL) while runtime session is **RUNNING**.
- Run random-search optimization over many parameter candidates on one or more tape files.
- Keep backend responsive during heavy optimization (worker thread).
- Support long runs: pause/resume/cancel, checkpoints, and looped execution.

## UI
Route: `/optimizer`

Main sections:
- Tape list (server directory)
- Optimization inputs (candidates/seed/tf/direction + filters + loop controls)
- Progress (0.01% precision) + per-run elapsed/ETA + loop elapsed
- Results table (live incremental updates)

## Tape directory
- Setting: `tapesDir` (backend filesystem path)
- Stored: `backend/data/optimizer_settings.json`

## Tape recording (automatic)
### When it records
- Recording is **automatic**:
  - starts on transition into `RUNNING`
  - stops on any non-RUNNING state (STOPPING/STOPPED/PAUSED)

### JSONL format
First line is always:
- `type: "meta"`
- Includes: tapeId, createdAt, sessionId, universeSelectedId, klineTfMin, symbols

Other line types:
- `type: "ticker"`
- `type: "kline_confirm"` (confirmed candles, when available)

### Ticker payload rules
- **Full-only**: write ticker only if all fields are present and finite:
  - `markPrice`, `openInterestValue`, `fundingRate`, `nextFundingTime`
- **Per-symbol throttle**: record each symbol at most once per **5000ms**

### Rotation (hard cap)
- Max tape segment size: **90 MB**
- When the active tape reaches the cap, recorder rotates to:
  - `...-seg2`, `...-seg3`, ...
- Recording stays ON (no session interruption).

## Optimization run
### Core inputs
- `candidates`: how many candidates to evaluate
- `seed`: RNG seed (base seed)
- `directionMode`: `both | long | short`
- `tf (opt)`: optimization timeframe override (used for replay/ref bucketing)

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
- selected tapeIds (sorted)
- directionMode
- tf(opt)

(runKey format is deterministic; stored in blacklist JSON.)

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

