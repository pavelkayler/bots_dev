## Milestone: Remote historical data cache

Status: **Implemented**

### Goals
- Tape recording subsystem removed (backend + frontend + UI).
- Replace it with an explicit **historical data cache** built from Bybit REST history endpoints for a user-selected **Universe** and **Range**.
- Optimizer operates on cached historical points and dataset histories.
- Standardize all tables/pagination UX across the app.

### Planned tasks
1) **Remove tape mechanics**
   - Delete tape recorder backend logic, related REST endpoints, and UI sections (tapes directory, tape list, recording status).
   - Remove optimizer/tape coupling.

2) **New UI for Universe + Range + data receive**
   - Universe selector.
   - Range presets: 24h, 48h, 1w, 2w, 4w, 1mo.
   - Manual start/end datetime.
   - Buttons:
     - **Receive Data**: apply the chosen Universe + Range as the dataset target and fetch missing historical points from Bybit into cache.
   - Data fetch progress bar aware of Bybit API limits (strict 500 requests / 5s).

3) **Unified tables and pagination**
   - All tables: rows-per-page, page count, total items, and first/last page buttons.

4) **Universe page changes**
   - Remove unused buttons: "Back to Dashboard", "Refresh List".
   - Fix Create request (remove 400).
   - Add Create progress bar.
   - Preserve Create state across routing.

5) **Optimizer UI simplification**
   - Remove single-run controls: "Run Optimization", "Pause", "Resume", "Stop" and the backend processes supporting them.
   - Keep manual from/to inputs and "Run in Range" checkbox removed (range is driven by the active dataset target via Receive Data).

### Notes / key design decisions
- Historical points source: Bybit REST endpoints (kline/OI/funding as required by strategy).
- `klineTfMin` is independent from Universe naming and does not change Universe file name/id semantics.
- Cache model: store per-symbol time-series on disk (SQLite or JSONL) and reuse for loop optimization without repeated API calls.
- Optionally allow “partial cache fill”: if cache already contains part of requested range, fetch only missing segments.

# 20 Future plan (next chat backlog)

Last update: 2026-02-25

This file is intentionally written as an actionable backlog for the next chat.

## Priority 0 — Make builds green
- Fix TypeScript build errors in backend and frontend (currently failing in some environments).
- After builds are stable, add a minimal CI script (optional).

## Priority 1 — Optimizer hardening
- Persist optimizer jobs/results to disk so a backend restart does not lose the last run.
- Add job cancellation.
- Add results export (CSV/JSON) and a small “run manifest” (tapeIds + ranges + precision + seed + candidates).
- Add a retention policy for tapes (optional): max files / max total size.

## Priority 2 — Reliability + observability
- Add unit tests:
  - config validation/normalization (incl. requireFundingSign enforcement)
  - wsHub message typing contract (snapshot/tick/events)
  - paper broker accounting invariants (fees/funding sign, realized/unrealized)
- Add a “run pack” export:
  - events.jsonl
  - summary.json
  - applied config snapshot (including universe symbol list)

## Priority 3 — Performance
- Worker threads for optimizer runner (optional). Current yielding keeps server responsive, but workers would isolate CPU fully.
- Frontend: ensure heavy dashboard tables render only when visible.

## Priority 4 — Strategy iteration tools
- Add per-signal counters (how many LONG/SHORT generated, blocked by direction, blocked by cooldown).
- Add a lightweight “why no trade” breakdown panel (aggregated reason counts).

## Priority 5 — Functional expansion (later)
- Real demo/real execution connectors (after paper stability).
- Multi-strategy modules (Lead-Lag, momentum, etc.) reusing this skeleton.
