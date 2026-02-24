# 12 LiveRows (Dashboard table) — Operator semantics

Last update: 2026-02-24

## Row identity
- One row per `symbol` from the currently applied runtime Universe.

## Columns (high-level)
- **Symbol / Mark / OIV**
  - last known values from WS tickers cache
- **Funding**
  - funding rate
  - next funding time (per symbol)
  - interval hours (if provided)
- **Moves**
  - `px`: priceMovePct vs previous candle close reference
  - `oi`: oivMovePct vs previous OIV reference at candle boundary
- **Cooldown**
  - funding cooldown active flag
- **Signal / Reason**
  - `LONG/SHORT/null` + reason code
- **Paper**
  - paper status: IDLE / ENTRY_PENDING / OPEN
  - side, qty, entry, TP/SL
- **PnL**
  - unrealized and realized paper pnl
- **Upd**
  - last update time for the underlying cache row

## ActiveOnly rule (UI)
ActiveOnly shows a row if:
- paper status is OPEN or ENTRY_PENDING, OR
- signal is LONG or SHORT

## Refresh behavior
- `rows` are pushed from server each second (`tick` message).
- manual "Refresh rows" triggers `rows_refresh_request` to request immediate update.
