# 01 Requirements & Constraints

## 1. Product goal (v1)
Build a local application that paper-trades Bybit **USDT Perpetual (linear)** pairs using:
- Price movement vs previous candle close (based on Mark Price)
- Open Interest Value (OIV, in USDT) movement vs previous candle OIV snapshot
- Funding sign as directional filter
- Global funding cooldown window (before/after next funding time)

**No API keys** (paper only).

## 2. Fixed inputs (from UI)
### Universe filters (apply once at start)
- minVolatility24hPct (default 5%)
- minTurnover24hUSDT (default 1,000,000)
- maxSymbols (typical 100–200)

### Strategy
- tfMin ∈ {1,3,5,10,15} (one TF per session)
- priceMovePctThreshold (global)
- oivMovePctThreshold (global)

### Trade (paper)
- marginUSDT
- leverage
- entryOffsetPct
- entryOrderTimeoutMin
- tpRoiPct (ROI% from margin)
- slRoiPct (ROI% from margin)

### Funding cooldown (global)
- beforeMin: "do not trade N minutes before funding"
- afterMin:  "do not trade N minutes after funding"

### Fees (no VIP)
Use base fee defaults (configurable in UI/config object):
- makerRate = 0.0001
- takerRate = 0.0006

> Paper uses maker fee for limit-touch fills.

## 3. Data sources
### Signals: Public WebSocket only
- `tickers.{symbol}` for:
  - markPrice
  - openInterestValue (OIV USDT)
  - turnover24h
  - highPrice24h / lowPrice24h
  - fundingRate
  - nextFundingTime
- `kline.{tfMin}.{symbol}` for:
  - candle close
  - confirm flag (close boundary)

### Bootstrap (start-only)
One-time REST to fetch instrument specs (tick/step/minQty) and symbol list:
- Market: instruments-info (category=linear)

## 4. Throughput / timing
- Backend emits **tick** updates to frontend at **1Hz** (<= 1 per second).
- Strategy evaluation runs at **1Hz**.
- Bybit WS ingestion is continuous; last-values cached in memory.

## 5. Execution constraints
- Per symbol: only **one active entry order** and then **one open position**.
- New triggers for a symbol are evaluated only after:
  - position is closed OR entry order expired/canceled
  - plus 1 second re-arm delay

## 6. STOP semantics
When session stops:
- cancel all active entry orders
- close all open positions immediately (paper) at current relevant price rule
- UI stops receiving symbol table updates

## 7. No features in v1
- No multi-bot manager
- No rebalancing/portfolio constraints
- No virtual wallet/balance
- No slippage
- No liquidation simulation
- No charts
- No imports/exports from UI
