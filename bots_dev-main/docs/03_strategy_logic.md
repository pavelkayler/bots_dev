# 03 Strategy Logic (Signal Engine)

Last update: 2026-02-24

## 1) Candle references (CandleTracker)
On `kline.<tf>.<symbol>`:
- when `confirm=true`, snapshot reference points for the next interval:
  - `prevCandleClose` = candle close
  - `prevCandleOivClose` = OIV from ticker cache at the boundary (OIV is not in kline)

## 2) Metrics
Using current mark price and current OIV:
- `priceMovePct = (mark - prevCandleClose) / prevCandleClose * 100`
- `oivMovePct = (oiv - prevCandleOivClose) / prevCandleOivClose * 100`

## 3) Funding cooldown gate
A per-symbol gate around next funding time:
- blocks signal generation in a window:
  - `beforeMin` minutes before funding
  - `afterMin` minutes after funding

## 4) Signal engine output
For each symbol:
- `signal`: `LONG | SHORT | null`
- `reason` codes:
  - `no_refs`
  - `threshold_not_met`
  - `funding_mismatch`
  - `cooldown`
  - `ok_long` / `ok_short`

Signals drive paper execution only while session is RUNNING.
