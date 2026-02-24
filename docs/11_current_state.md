# 11 Current State (what exists now) + Next Actions

Last update: 2026-02-24

## What the project is
A Bybit USDT‑perpetual bot skeleton with:
- market WS ingestion
- signal generation + reasons
- paper execution
- operator UI

## Implemented (expected behavior)
- Universe Builder:
  - filters by 24h turnover and 24h volatility
  - saves a universe set to file
- Dashboard:
  - LiveRows table (1Hz) shows market metrics + signal + paper state
  - ActiveOnly filters to “active” symbols
  - Events tail shows last N events, download JSONL
  - Summary appears after stop

## LiveRows — what it does and what it is not
LiveRows is an **operator view** built from the current runtime universe symbol list.
It is responsible for:
- presenting last known market fields (mark, OIV, funding, next funding time)
- presenting derived metrics (price move %, OIV move % based on candle refs)
- showing gating status (funding cooldown) and signal + reason
- showing paper state (pending/open, entry/tp/sl, PnL)

LiveRows is NOT:
- a trading engine loop by itself
- a data source of truth (truth is WS cache + events JSONL)

## Known issue (in progress)
Sometimes LiveRows becomes empty or stops updating while events still stream.
Root cause: rows are built only from fully-populated cache entries; partially missing ticker fields can exclude symbols.
Planned fix: build rows from Universe symbols list and apply safe defaults for missing cache values.

## Next actions
1) Fix LiveRows reliability (rows must always exist for universe symbols).
2) Move Bot stats summary calculation to backend and push via WS, so frontend reload does not reset totals.
3) Add export pack (events + summary + config snapshot) to simplify offline analysis.
