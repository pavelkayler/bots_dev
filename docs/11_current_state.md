# 11 Current State (what exists now) + Next Actions

Last update: 2026-03-08

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

### Process indicators
- `GET /api/process/status` provides additive operational status for:
  - runtime session state/message
  - optimizer loop/job progress
  - active Receive Data job progress
  - recorder state/mode/message with write counters

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
- Live rows (coalesced up to 10Hz) card:
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
  - trades table supports global sort + shared pagination (10/25/50)
- UI split for bot growth:
  - `/bots` page handles strategy/bot settings
  - `/` dashboard focuses on operator execution/start controls
  - `/optimizer` is bot-aware (bot + bot preset selection)

### Config + Presets
- Config is edited as **draft** and applied via **Apply**.
- Numeric inputs allow empty while typing; Apply validates and blocks if required fields are empty/invalid.
- Apply gating:
  - disabled if Universe not selected
  - disabled if draft == applied
  - disabled if invalid
- While runtime is active, Apply updates trading parameters for next entries only (`applied.paper = "next_trades"`). Existing open trade state is not retroactively rewritten.

Apply-and-Run / record controls are removed. Optimizer uses dataset histories/cache only.
- Runtime is bot-aware via `selectedBotId` with a minimal registry.
- Registered bots:
  - `oi-momentum-v1` (OI Momentum)
  - `signal-multi-factor-v1` (Signal Multi-Factor)
- Bot can be selected from Dashboard and Optimizer through shared bot selectors.
- A dedicated operational page `/signal-bot` is available for signal-bot control/status context.
- Config is split into:
  - bot config (strategy semantics, includes TP/SL)
  - shared execution profile (execution/session/risk controls only)
  - resolved runtime config (compatibility shape used by runtime and ws/optimizer)
- Presets:
  - legacy runtime presets remain compatible in `backend/data/presets/*.json`
  - bot presets are separate and keyed by botId (`backend/data/bot_presets/*.json`)
  - execution profiles are separate (`backend/data/execution_profiles/*.json`)
  - TP/SL lives in bot presets, not in execution profiles

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
  - Tape APIs/recording are removed; optimizer inputs are dataset histories/cache only
  - data comes only from Receive Data cache + Dataset Target
  - price cache: `backend/data/cache/bybit_klines/` (1m candles)
  - OI cache: Bybit 5-minute historical OI is the active source (`backend/data/cache/bybit_open_interest/5min/`), expanded to minute rows via last-known Bybit values
  - funding cache: `backend/data/cache/bybit_funding_history/` from `/v5/market/funding/history`, applied as last-known value between points
- Receive Data completion is strict: a dataset is marked done only when every required 1m candle has OI populated
- CoinGlass backfill code remains in repository but is disabled in current flow (`COINGLASS_ENABLED=0`)
- Receive Data progress includes backend ETA (`etaSec`) and UI shows `ETA: ~Xm Ys`

### Bot isolation (OI Momentum vs Signal Bot)
- Optimizer history is bot-scoped end-to-end:
  - backend `/api/optimizer/jobs/history` accepts `botId` and filters rows by `runPayload.selectedBotId`
  - frontend optimizer always requests history with active/forced bot id
- Legacy optimizer history rows without bot id are treated as OI-only compatibility rows and are not shown on Signal Bot optimizer surfaces.
- Optimizer local UI persistence is bot-scoped in localStorage:
  - ranges, candidates, seed, tf, filters, follow-tail start, loop flags, and table page-size preferences are all keyed by bot id.
- Signal Bot page no longer force-switches global bot selection on open.
  - This removes cross-page selection side effects while keeping Signal optimizer/settings explicitly scoped.

### Signal Bot model (current MVP)
- Signal Bot is treated as a market overheating/exhaustion strategy, not an OI Momentum clone.
- Core inputs used by Signal engine:
  - Bybit 1m price candles (price move)
  - Bybit OI path (usable 5m historical path expanded in replay)
  - Bybit funding history
  - Bybit public trades with internal CVD derivation
- CoinGlass low-timeframe OI/liquidation is optional diagnostics only on current plan and is not a hard dependency for Signal runtime/optimizer.

### Recorder foundation (minute OI path)
- A dedicated recorder foundation exists in `backend/src/recorder/MinuteOiRecorder.ts`.
- Recorder input source is Bybit WS ticker updates.
- Recorder persists only intermediate minute OI points (non-5-minute boundaries), so Bybit 5-minute boundary points remain authoritative.
- Recorder rows are timestamped and merge-ready for future metric enrichment by timestamp.
- Recorder modes:
  - `record_only`: recorder keeps WS stream and records without trading session
  - `record_while_running`: recorder records only while runtime is RUNNING/RESUMING
- Recorder control endpoints:
  - `GET /api/recorder/status`
  - `POST /api/recorder/mode` with `mode: off | record_only | record_while_running`
- Recorder universe endpoints:
  - `GET /api/recorder/universe`
  - `POST /api/recorder/universe` (set by `selectedId` or direct `symbols[]`)
- Recorder universe is persisted separately from trading universe and used for recorder symbol selection.

### Signal bot data-source policy
- Primary source remains Bybit for runtime and optimizer replay.
- CoinGlass is optional and used only where an endpoint/metric is available for the active key/plan.
- Current app behavior does not make CoinGlass a hard dependency for starting runtime/optimizer signal flows.
- Hobbyist baseline constraints to account for when integrating optional CoinGlass metrics:
  - 30 requests per minute
  - up to 1-minute refresh cadence
- Availability of specific advanced metrics on higher CoinGlass tiers depends on the plan and should be validated against current CoinGlass pricing/docs at integration time.

- Optimization:
  - run payload supports `selectedBotId` and `selectedBotPresetId`
  - dataset mode supports:
    - `snapshot` (fixed histories)
    - `followTail` (fixed start + moving end at current time per loop/run start)
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
  - `signal window (min)` minimum is 5m
  - OI for signal windows uses underlying minute OI path inside each higher timeframe window (not only coarse boundary values)

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

## Environment
- Root `.env.example` is present and includes backend/runtime/optimizer dataset vars:
  - `PORT`, `HOST`
  - `BYBIT_REST_URL`, `BYBIT_DEMO_REST_URL`, `BYBIT_DEMO_API_KEY`, `BYBIT_DEMO_API_SECRET`, `BYBIT_RECV_WINDOW`
  - `COINGLASS_API_KEY`, `COINGLASS_BASE_URL`
  - `DEBUG_DATASET_TF`, `DEBUG_OPT_TRADES`, `DEBUG_OPT_MARKETDATA`

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


## Stability hardening (latest)
- Runtime stop uses a per-run context with `runId` + `AbortController` and a hard stop timeout, so STOP requests abort in-flight startup/cleanup work and always converge to `STOPPED`.
- Stop is idempotent while `STOPPING` (reuses a single stop promise), and transition logs include `runId`, from/to state, plus stop duration.
- Execution layer enforces a per-symbol invariant (`FLAT | OPENING | OPEN | CLOSING`) to prevent entry stacking while a symbol is not flat.
- Entry IDs are deterministic per run/symbol/attempt in paper+demo paths for idempotent OPENING behavior.
- Fill/exit decision logic is centralized in `backend/src/execution/executionRules.ts` and used by paper execution (therefore optimizer replay, which runs through paper broker, uses identical limit + TP/SL rules and worst-case conservative tie-break).
- Backend risk limits are runtime-enforced via `riskLimits` (`maxTradesPerDay`, `maxLossPerDayUsdt`, `maxLossPerSessionUsdt`, `maxConsecutiveErrors`).
- `maxTradesPerDay` counts actual opened entries (`ORDER_FILLED` / `POSITION_OPEN` / `DEMO_POSITION_OPEN`), not placement attempts.
- On risk breach, runtime emits `EMERGENCY_STOP`, sets session runtime message `Emergency stop: <reason>`, and triggers the hardened STOP flow automatically.
- Emergency-stop state is sticky for the run lifecycle: it blocks further entries/resume continuation and is cleared only on a clean new start/reset cycle.
