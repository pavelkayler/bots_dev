# 11 Current State (what exists now) + Next Actions

Last update: 2026-02-25

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
  - `GET /api/session/summary` (+ download)
- Each session creates:
  - `backend/data/sessions/<sessionId>/events.jsonl`
  - `backend/data/sessions/<sessionId>/summary.json` (after stop)

### Streams lifecycle (important)
- Backend connects to Bybit public WS **only while session is RUNNING**.
- On STOPPING/STOPPED:
  - upstream WS is closed
  - reconnect timers are cancelled
  - LiveRows `rows` are pushed as empty array (operator sees no tickers while stopped)

### Dashboard (operator view)
- Header shows:
  - CONNECTED (UI ↔ backend `/ws`)
  - Streams status (Bybit upstream)
  - Session status (RUNNING/STOPPING/STOPPED)
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
- Config is edited as **draft** and applied via Apply / Apply and Run.
- Numeric inputs allow empty while typing; Apply validates and blocks if required fields are empty/invalid.
- Apply gating:
  - disabled if Universe not selected
  - disabled if draft == applied
  - disabled if invalid
- Apply and Run (was “Apply and Reboot”):
  - Apply config patch, then:
    - if RUNNING: STOP → START
    - if STOPPED: START
  - UI suppresses the intermediate stop-summary flash.
- Start and Record:
  - performs Apply-and-Run flow
  - then starts Optimizer tape recording (new tape)
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
- Tape recording (RUNNING-only)
  - configurable tapes directory (`tapesDir`)
  - ticker writes are full-only (4 required fields) and throttled per symbol (>= 5s)
- Optimization runs as a job:
  - job continues on backend across navigation/reload
  - UI restores current/last job and fetches results when done
  - server-side sorting + pagination
- Multi-tape selection:
  - candidate is replayed across all selected tapes and results are aggregated
- Operator inputs are persisted:
  - ranges + candidates + seed are auto-saved and restored
- Params are displayed as separate sortable columns.

## Known issues / tech debt (as of 2026-02-25)
- Local `npm run build` may fail due to unrelated pre-existing TypeScript typing issues.
- No automated tests yet (WS contract + config validation + paper broker).
- Optimizer jobs are in-memory (backend restart clears job state).

## Next actions (recommended)
1) Fix TS build errors on both backend + frontend (make CI green).
2) Add minimal unit tests for:
   - config validation/normalization (incl. requireFundingSign enforcement)
   - WS message typing contract
   - paper fee/funding accounting invariants
3) Optimizer hardening:
   - persist job state/results to disk (optional)
   - add cancellation
   - add export of results (CSV/JSON)
