# 12 LiveRows (Dashboard table) — Operator semantics

Last update: 2026-02-25

## Row identity
- One row per `symbol` from the **currently applied runtime Universe**.
- When session is STOPPING/STOPPED, server pushes `rows: []` by design (no tickers while stopped).

## Update cadence
- Server sends `tick` (1Hz) while RUNNING.
- “Refresh rows” triggers `rows_refresh_request` for immediate update.

## Header controls (UI)
- **Active only**
  - filters displayed rows to “active” symbols.
- **rows:N**
  - count of displayed rows after filtering.
- **Next candle in MM:SS**
  - countdown to the next closed candle boundary, based on **draft** `klineTfMin`.
  - operator-only convenience; it does not change backend behavior until Apply.
- **Refresh rows**
  - requests immediate `tick` update (no polling).

## Columns (high-level)
- **Symbol / Mark / OIV**
  - last known values from Bybit tickers cache (mark price, open interest value)
- **Funding**
  - funding rate
  - next funding timestamp
- **Moves**
  - `px`: priceMovePct vs previous candle close reference
  - `oi`: oivMovePct vs previous OIV reference at candle boundary
- **Cooldown**
  - funding cooldown gate active flag
- **Signal / Reason**
  - `LONG/SHORT/null` + reason code
  - direction gating:
    - if `paper.directionMode="long"` then SHORT is suppressed (no signal + no reason)
    - if `paper.directionMode="short"` then LONG is suppressed
- **Paper**
  - paper status: IDLE / ENTRY_PENDING / OPEN
  - side, qty, entry, TP/SL
- **PnL**
  - unrealized and realized paper pnl
- **Upd**
  - last update time for the underlying row

## Optional 24h fields (not necessarily displayed)
SymbolRow may include 24h market fields derived from tickers:
- `turnover24hUsd`
- `highPrice24h`
- `lowPrice24h`
These are used for enriching Trade Stats (turnover/volatility) and Universe Builder filtering.

## ActiveOnly rule (UI)
ActiveOnly shows a row if:
- paper status is OPEN or ENTRY_PENDING, OR
- signal is LONG or SHORT

## Table pagination standard (planned)

All tables should follow a consistent pagination UX:
- Rows per page selector
- Page indicator: "Page X of Y"
- Total records count
- Navigation: first (<<), prev (<), next (>), last (>>)

This applies to:
- Universe list
- Optimizer completed/stopped runs
- Any future cache job/history tables

