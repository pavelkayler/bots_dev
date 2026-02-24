# 02 Bybit Data Interfaces (V5)

## 1. WebSocket
### Endpoint (public linear)
Use official Bybit V5 public WS for linear instruments.

Key topics (per symbol):
- `tickers.{symbol}` — snapshot + delta updates
- `kline.{tfMin}.{symbol}` — candle stream; use `confirm=true` for close boundary

Important behavior:
- Tickers are **snapshot + delta**: if a field is missing, it means it has not changed; keep last known value in memory.

### Operational constraints
- Subscribe args length limit (public WS): total `args` length up to 21,000 characters per connection.
  - For 100–200 symbols with 2 topics each, implement **batching** and potentially **multiple WS connections**.

### Heartbeat & reconnect
- Maintain ping/pong.
- On disconnect: reconnect with backoff, then resubscribe to all topics for that connection.

## 2. REST bootstrap (start-only)
To simulate "as exchange":
- tickSize (price step)
- qtyStep / minQty
- additional constraints if needed

Use V5 Market endpoint:
- `GET /v5/market/instruments-info?category=linear`

Store per symbol:
- tickSize
- qtyStep
- minQty
- optionally minNotional, maxOrderQty if needed later

## 3. Fields used in this project (canonical)
### Tickers (per symbol)
- markPrice
- openInterestValue
- turnover24h
- highPrice24h
- lowPrice24h
- fundingRate
- nextFundingTime (timestamp)

### Kline (per symbol, per tfMin)
- close
- confirm (true at candle close)

## 4. Funding cooldown window (global gate)
From tickers:
- nextFundingTimeTs

Cooldown parameters:
- beforeMin, afterMin

Cooldown interval:
- [nextFundingTimeTs - beforeMin*60s, nextFundingTimeTs + afterMin*60s]

Inside cooldown:
- session state is COOLDOWN
- signals are not evaluated
