# 11 Current State (what exists now) + Next Actions

Last update: 2026-02-25

## What the project is
A Bybit USDT‑perpetual bot skeleton focused on **operator-visible** paper testing:
- Bybit public WS ingestion (tickers + kline refs)
- signal generation + reason codes
- paper execution (ROI-based TP/SL + maker fee; optional funding)
- sessioned JSONL eventlog + summary
- operator UI (Dashboard + Universe Builder)

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
- Live rows (1Hz) card:
  - Active only toggle + rows count
  - “Next candle in MM:SS” countdown (based on **draft** `klineTfMin`)
  - Refresh rows button (requests immediate tick update)
- Bot stats:
  - open/pending counts + pnl + closed trades + net realized + fees/funding
  - uptime next to RUNNING badge
- Trade stats by symbol (real-time):
  - per-symbol aggregation from streamed close events
  - sortable columns
- Events tail:
  - selectable limit (5/25/50/100)
  - download JSONL
- Summary:
  - resets on Start (new run)
  - loads on Stop
  - trades table supports global sort + pagination (50/100/200)

### Config + Presets
- Config is edited as **draft** and applied via Apply / Apply & Reboot.
- Numeric inputs allow empty while typing; Apply validates and blocks if required fields are empty/invalid.
- Apply gating:
  - disabled if Universe not selected
  - disabled if draft == applied
  - disabled if invalid
- Apply & Reboot:
  - Apply config, stop (if RUNNING), then start again
  - suppresses the intermediate stop-summary flash in UI
- Presets:
  - selector + Save (overwrite) + Remove
  - option label includes timeframe: `... [tf=<klineTfMin>m]`
  - preset selection best-effort auto-selects Universe by matching the bracket token (e.g. `[10m/6%]`) to saved universe name
  - presets stored in `backend/data/presets/*.json`

### Direction mode (paper)
- `paper.directionMode`: `"both" | "long" | "short"` (default `"both"`)
- Signal display + trading are both gated:
  - when mode blocks a direction, that signal is not shown and no trade is opened

### Universe Builder (/universe)
- Inputs:
  - min turnover 24h (USD)
  - min volatility 24h (%), defined as `(high-low)/low*100`
  - inputs allow empty while typing; Create validates
- Uses REST instruments-info only to seed valid USDT linear symbols.
- Uses WS tickers to compute turnover/volatility filters.
- Saves universes to `backend/data/universes/*.json`
- Delete button exists; deletion forbidden (409) if universe is in use by RUNNING session.

## Known issues / tech debt (as of 2026-02-25)
- Local `npm run build` may fail due to unrelated pre-existing TypeScript typing issues (to be addressed next).
- No automated tests yet (WS contract + config validation + paper broker).

## Next actions (recommended)
1) Fix TS build errors on both backend + frontend (make CI green).
2) Add minimal unit tests for:
   - config validation/normalization (incl. directionMode migration)
   - WS message typing contract
   - paper fee/funding accounting invariants
3) Add “export pack” download (events + summary + config snapshot) for offline analysis.
