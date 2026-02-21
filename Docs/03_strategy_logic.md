# 03 Strategy Logic (Signal Engine)

## 1. Candle boundary and snapshots
We only consider triggers after the previous candle has closed.

At `kline.confirm=true`:
- `prevCandleClose = kline.close`
- `prevCandleOivClose = lastTicker.openInterestValue` (sampled at close boundary)

These values remain the "reference" for the next candle window until the next confirm.

## 2. Trigger evaluation timing
After candle close, during the *current open candle*, at 1Hz:

Let:
- `markNow = lastTicker.markPrice`
- `oivNow  = lastTicker.openInterestValue`

Compute:
- `priceMovePct = (markNow - prevCandleClose) / prevCandleClose * 100`
- `oivMovePct   = (oivNow  - prevCandleOivClose) / prevCandleOivClose * 100`

## 3. Funding gate (global)
If in funding cooldown window:
- set session state = COOLDOWN
- do not evaluate signals at all

If funding fields missing/invalid for a symbol:
- do not trade that symbol

## 4. Signal rules (strict)
### LONG
Open LONG cycle if all hold:
- priceMovePct >= +priceMovePctThreshold
- oivMovePct   >= +oivMovePctThreshold
- fundingRate  > 0
- symbol is free (no active order, no open position)
- not in cooldown

### SHORT
Open SHORT cycle if all hold:
- priceMovePct <= -priceMovePctThreshold
- oivMovePct   <= -oivMovePctThreshold  (OIV falling)
- fundingRate  < 0
- symbol is free
- not in cooldown

All other combinations are ignored.

## 5. Symbol-level cycle constraints
Per symbol:
- only one active entry order at a time
- only one open position at a time
- after cycle ends (order expired/canceled OR position closed), re-arm after 1 second

## 6. Limit entry price via offset from mark
When signal fires at time T:

- LONG entry limit:
  `entryPrice = markNow * (1 - entryOffsetPct/100)`

- SHORT entry limit:
  `entryPrice = markNow * (1 + entryOffsetPct/100)`

Order timeout:
- expires at `T + entryOrderTimeoutMin`

Fill condition (touch fill):
- LONG filled if markPrice <= entryPrice
- SHORT filled if markPrice >= entryPrice
