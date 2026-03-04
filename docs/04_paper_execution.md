# 04 Paper Execution (Orders, Positions, PnL)

Last update: 2026-03-04

Paper broker simulates:
- limit entry with offset and timeout
- position sizing by margin and leverage
- TP/SL defined by ROI% on margin
- maker fee on entry and exit
- funding direction gating is supported for entries; funding fee is not added to optimizer pnl

## Execution models

PaperBroker supports two bar execution modes:

- `closeOnly` (default)
  - Uses `markPrice` only for entry fill and TP/SL checks.
  - Preserves historical behavior.

- `conservativeOhlc`
  - Uses provided 1m OHLC range to test whether level touches are possible inside the minute.
  - Does not simulate intra-bar path.
  - Uses conservative worst-case ordering for ambiguous bars.

## Entry
- `entryPrice = markPrice * (1 ± entryOffsetPct)`
- order expires after `entryTimeoutSec`

Entry fill checks:
- `closeOnly`:
  - LONG fills when `markPrice <= entryPrice`
  - SHORT fills when `markPrice >= entryPrice`
- `conservativeOhlc`:
  - LONG fills when `low <= entryPrice`
  - SHORT fills when `high >= entryPrice`

## Sizing
- `qty = (marginUSDT * leverage) / entryPrice`

## TP/SL (ROI-based)
- target ROI% is computed against margin:
  - take profit by `tpRoiPct`
  - stop loss by `slRoiPct`

Trigger checks:
- LONG:
  - TP when `high >= tpPrice` (`closeOnly`: `markPrice >= tpPrice`)
  - SL when `low <= slPrice` (`closeOnly`: `markPrice <= slPrice`)
- SHORT:
  - TP when `low <= tpPrice` (`closeOnly`: `markPrice <= tpPrice`)
  - SL when `high >= slPrice` (`closeOnly`: `markPrice >= slPrice`)

Worst-case resolution in `conservativeOhlc`:
- If TP and SL are both reachable in one bar, SL wins.
- If entry and TP/SL are all possible in one bar:
  - assume entry fills,
  - then SL closes if reachable,
  - else TP closes if reachable,
  - else position stays open.

Close price for TP/SL events remains the TP/SL level itself (not bar close).

## Rearm delay
- `rearmDelayMs` is persisted as milliseconds in backend config.
- Config UI edits this value as `rearmSec` and sends `rearmDelayMs = round(rearmSec) * 1000` on apply.
- No upper cap is enforced; large values are allowed intentionally.

## Logging
All actions are written to `events.jsonl` (one event per line) and streamed to UI via WS.
