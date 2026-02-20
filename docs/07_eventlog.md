# 07 Eventlog (JSONL) — canonical event payloads

File:
- ./data/sessions/<sessionId>/events.jsonl
- One JSON object per line (append-only)

## Common fields (all events)
- id: string (monotonic or UUID)
- ts: number (ms epoch)
- type: EventType
- symbol: string | null
- data: object

## Recommended event payloads

### session_started
data:
- config: full SessionStartRequest (including fee defaults)

### universe_built
data:
- symbols: string[]
- count: number
- filters: { minVolatility24hPct, minTurnover24hUSDT, maxSymbols }

### cooldown_entered / cooldown_exited
data:
- fromTs
- untilTs
- nextFundingTimeTs

### signal_fired
data:
- tfMin
- decision: LONG|SHORT
- markPrice
- prevCandleClose
- priceMovePct
- oivUSDT
- prevCandleOivUSDT
- oivMovePct
- fundingRate
- nextFundingTimeTs

### order_placed
data:
- side: BUY|SELL
- price
- qty
- placedTs
- expiresTs
- reason: signal_fired

### order_filled
data:
- side
- price
- qty
- fillTs
- feeUSDT

### order_expired / order_canceled
data:
- side
- price
- qty
- placedTs
- expiresTs
- finalTs

### position_opened
data:
- side: LONG|SHORT
- entryPrice
- qty
- tpPrice
- slPrice
- entryFeeUSDT

### funding_applied
data:
- side
- fundingRate
- notionalUSDT
- paymentUSDT
- fundingTs
- fundingAccruedUSDT (cumulative)

### position_closed
data:
- side
- entryPrice
- exitPrice
- qty
- exitTs
- reason: TP|SL|STOP
- pnlUSDT
- roiPct
- feesTotalUSDT
- fundingAccruedUSDT

### session_stopped
data:
- canceledOrders: number
- closedPositions: number
- stopTs
