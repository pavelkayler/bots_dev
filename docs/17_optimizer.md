# 17 Optimizer (Tape recording + Replay batch search)

Last update: 2026-02-25

This document describes the **Optimizer** feature added to help tune paper-trading parameters using a recorded market “tape” and deterministic replay.

## Goals
- Record a lightweight market tape (JSONL) while the runtime session is **RUNNING**.
- Run a batch optimization (random search) over many parameter candidates on the **same** tape(s) to compare configs fairly.
- Keep the main Dashboard behavior unchanged.

## UI
- Route: `/optimizer`
- Main sections:
  - Tape recording (start/stop + tapes list)
  - Optimization inputs (candidates/seed + ranges)
  - Results table (server-side sorting + pagination)

## Tape directory (server-side)
Optimizer uses a configurable server filesystem directory:
- Setting name: `tapesDir`
- Stored in: `backend/data/optimizer_settings.json`
- UI provides a modal to set the directory path.

Important:
- This is a **server** directory path (backend filesystem). The UI cannot use a browser folder picker to select server paths.

## Tape recording
### Recording conditions
- Recording may start only when session state is **RUNNING**.
- Recording stops only by explicit Stop action.

### JSONL format
Each tape is a JSONL file. First line is always meta:
- `type: "meta"`
- Includes tape id, createdAt, sessionId, applied universe id, klineTfMin, and symbols.

Other line types:
- `type: "ticker"`
- `type: "kline_confirm"` (only confirmed candles)

### Ticker payload rules (important)
- **Full-only**: ticker lines are written only when all fields are available and finite:
  - `markPrice`
  - `openInterestValue`
  - `fundingRate`
  - `nextFundingTime`
- **Per-symbol throttle**: a given symbol is recorded at most once per **5000ms**.

This keeps tapes compact and ensures replay always has complete market snapshots.

## Optimization run
### Inputs
- `candidates` — number of parameter sets to try.
- `seed` — deterministic RNG seed for random search.
- `ranges` — inclusive min/max for each parameter:
  - `priceTh` → `signals.priceThresholdPct`
  - `oivTh` → `signals.oivThresholdPct`
  - `tp` → `paper.tpRoiPct`
  - `sl` → `paper.slRoiPct`
  - `offset` → `paper.entryOffsetPct`

### Dynamic precision (step) per parameter
Quantization step is derived from the user-entered Min/Max strings:
- For each param:
  - `decimals = max(decimals(minStr), decimals(maxStr))`
  - `step = 10^-decimals`
Examples:
- min `1`, max `6.000` → decimals=3 → step `0.001`
- min `1.0`, max `6.0` → decimals=1 → step `0.1`

The frontend computes precision from strings and sends it to backend for candidate generation, formatting, and Copy-to-settings.

### Multi-tape
UI can select multiple tapes.
- For each candidate, the runner replays it on every selected tape and aggregates:
  - `netPnlTotal = sum(netPnl per tape)`
  - `tradesTotal = sum(trades per tape)`
  - `winsTotal = sum(wins per tape)`
  - `winRatePct = winsTotal / tradesTotal * 100` (when tradesTotal > 0)

### Jobs + progress + responsiveness
Optimization runs as an in-memory job:
- `POST /api/optimizer/run` returns `{ jobId }` quickly.
- Backend yields to the event loop at integer percent boundaries (1..100) so the server stays responsive.
- UI polls `/status` to show progress and then fetches paged results.

Persistence:
- Jobs continue on backend while running.
- UI restores the current/last job on mount via `/api/optimizer/jobs/current`.

## Results table
- Server-side sorting across all pages.
- Page size fixed at 50.
- Params are split into columns:
  - `priceTh`, `oivTh`, `tp`, `sl`, `offset`
  - Each sortable.

## Copy to settings
- Each result row has `Copy to settings`.
- Clicking it writes a pending config patch to localStorage.
- Config page reads and merges this patch into **draft** (no auto-apply).
- Operator must still click **Apply**.

## Local persistence (frontend)
Optimizer stores operator inputs in localStorage:
- ranges (autosave)
- `candidates` and `seed`
This prevents resets on navigation.

## Limitations / known constraints
- Optimizer jobs are stored in memory: backend restart clears job state.
- Tape directory is a server path; UI cannot browse the server filesystem.
