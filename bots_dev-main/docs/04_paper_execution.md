# 04 Paper Execution (Orders, Positions, PnL)

Last update: 2026-02-24

Paper broker simulates:
- limit entry with offset and timeout
- position sizing by margin and leverage
- TP/SL defined by ROI% on margin
- maker fee on entry and exit
- optional funding application at funding boundary (best-effort)

## Entry
- `entryPrice = markPrice * (1 ± entryOffsetPct)`
- order expires after `entryTimeoutSec`

## Sizing
- `qty = (marginUSDT * leverage) / entryPrice`

## TP/SL (ROI-based)
- target ROI% is computed against margin:
  - take profit by `tpRoiPct`
  - stop loss by `slRoiPct`

## Logging
All actions are written to `events.jsonl` (one event per line) and streamed to UI via WS.
