# OPERATOR_GUIDE.md

## Quick start

### Prerequisites
- Node.js **20.x LTS** (v1-stable baseline)
- npm 10+

### Install
```bash
npm install --prefix backend
npm install --prefix frontend
```

### Run locally
```bash
npm run dev:start
```

Services:
- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`
- Frontend WS: `ws://localhost:3000/ws`

### Stop
- In UI: click **STOP**
- CLI: `npm run dev:stop`

Session logs are written to:
- `data/sessions/<sessionId>/events.jsonl`

---

## What the bot does (high level)
This v1 bot paper-trades Bybit USDT perpetual symbols (linear) using:
1. Mark price move vs previous candle close.
2. OIV move vs previous candle OIV snapshot.
3. Funding sign direction filter.
4. Global funding cooldown window around next funding timestamp.

It evaluates strategy at **1Hz**, emits UI ticks at **1Hz**, and keeps market ingestion continuous through Bybit public WS.

No API keys are used in v1 (paper only).

---

## Known-good default profile (v1 stable)
These are the fixed baseline defaults used by Config page and API contract:

- `universe.minVolatility24hPct = 5`
- `universe.minTurnover24hUSDT = 1000000`
- `universe.maxSymbols = 200`
- `tfMin = 5`
- `signal.priceMovePctThreshold = 0.8`
- `signal.oivMovePctThreshold = 2.0`
- `trade.marginUSDT = 100`
- `trade.leverage = 10`
- `trade.entryOffsetPct = 0.15`
- `trade.entryOrderTimeoutMin = 10`
- `trade.tpRoiPct = 5`
- `trade.slRoiPct = 3`
- `fundingCooldown.beforeMin = 15`
- `fundingCooldown.afterMin = 10`
- `fees.makerRate = 0.0001`
- `fees.takerRate = 0.0006`

---

## Config reference and strategy math mapping

### Universe filters (applied once at session start)
- `minVolatility24hPct`: minimum 24h volatility required.
- `minTurnover24hUSDT`: minimum 24h turnover required.
- `maxSymbols`: max symbols to include after filtering.

### Strategy timeframe
- `tfMin`: one timeframe per session (`1 | 3 | 5 | 10 | 15`).
- At `kline.confirm=true`, references are snapped:
  - `prevCandleClose = kline.close`
  - `prevCandleOivUSDT = lastTicker.openInterestValue`

### Signal thresholds
Computed during the current open candle at 1Hz:
- `priceMovePct = (markNow - prevCandleClose) / prevCandleClose * 100`
- `oivMovePct = (oivNow - prevCandleOivUSDT) / prevCandleOivUSDT * 100`

Trigger checks:
- LONG candidate: `priceMovePct >= threshold`, `oivMovePct >= threshold`, `fundingRate > 0`
- SHORT candidate: `priceMovePct <= -threshold`, `oivMovePct <= -threshold`, `fundingRate < 0`

### Trade controls
- `marginUSDT`, `leverage`:
  - `notional = marginUSDT * leverage`
  - `qtyRaw = notional / entryPrice` (then rounded to exchange constraints)
- `entryOffsetPct`:
  - LONG entry limit: `markNow * (1 - entryOffsetPct/100)`
  - SHORT entry limit: `markNow * (1 + entryOffsetPct/100)`
- `entryOrderTimeoutMin`: entry order expiry minutes.
- `tpRoiPct`, `slRoiPct`:
  - LONG: `tp = entry * (1 + rTP/L)`, `sl = entry * (1 - rSL/L)`
  - SHORT: `tp = entry * (1 - rTP/L)`, `sl = entry * (1 + rSL/L)`

### Funding cooldown
- `beforeMin`: disallow new signal evaluations N minutes before funding.
- `afterMin`: disallow new signal evaluations N minutes after funding.
- During window, session state is `COOLDOWN`.

### Fees
- `makerRate`, `takerRate`: configurable fee assumptions.
- v1 paper execution uses maker-style fee estimation for touch-limit model.

---

## Symbols table interpretation

### Core computed columns
- `priceMovePct`: current mark move vs last confirmed candle close.
- `oivMovePct`: current OIV move vs OIV snapshot taken at candle confirm.

### `status` meanings
- `IDLE`: not armed for trigger processing yet.
- `ARMED`: eligible for signal evaluation (subject to gates).
- `ORDER_PLACED`: active entry order exists.
- `POSITION_OPEN`: open paper position exists.

### `gates` meanings
- `COOLDOWN`: global funding cooldown gate is active (`cooldownBlocked=true`).
- `STALE`: data not ready (`dataReady=false`), usually missing/invalid funding fields or stale ticker fields.

---

## Events table and eventlog JSONL

### Event stream sources
- UI table receives `events_append` over WS.
- Durable session log is `data/sessions/<sessionId>/events.jsonl` (JSON per line).

### Key event types to watch
- `session_started`, `universe_built`
- `cooldown_entered`, `cooldown_exited`
- `signal_fired`
- `order_placed`, `order_filled`, `order_expired`, `order_canceled`
- `position_opened`, `funding_applied`, `position_closed`
- `session_stopped`

### Example JSONL lines (short)
```json
{"id":"evt_1","ts":1760954101200,"type":"signal_fired","symbol":"BTCUSDT","data":{"decision":"LONG","priceMovePct":0.92,"oivMovePct":2.3,"fundingRate":0.0001}}
{"id":"evt_2","ts":1760954120000,"type":"position_opened","symbol":"BTCUSDT","data":{"side":"LONG","entryPrice":67888.0,"qty":0.0147,"tpPrice":68227.4,"slPrice":67684.3}}
{"id":"evt_3","ts":1760956799000,"type":"session_stopped","symbol":null,"data":{"canceledOrders":1,"closedPositions":1,"stopTs":1760956799000}}
```

---

## Stop semantics
When stop is requested, v1 behavior is:
1. Move to stopping flow.
2. Cancel all active entry orders.
3. Close all open positions immediately (paper close rule).
4. Emit stop events/final state.
5. Freeze symbol table rendering/updates in UI after stop confirmation.

---

## Data limitations (v1 paper approximation)
- Paper-only simulation (no exchange order placement).
- No slippage model.
- No liquidation model.
- No portfolio wallet/balance simulation.
- Universe is fixed at session start (no mid-session universe rebuild).
