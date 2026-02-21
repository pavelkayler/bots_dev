# Engine runtime notes (Task #3)

## Universe warm-up window
- Universe is built once at session start and then frozen.
- Backend loads linear instrument specs via REST `instruments-info` and derives candidate symbols (`*USDT`).
- WS is first configured as ticker-only for all candidates.
- Warm-up window is `~4s` (`DEFAULT_WARMUP_MS` in `UniverseBuilder.ts`) to collect ticker snapshots/deltas.
- After warm-up, symbols are filtered by:
  - `vol24hPct = (highPrice24h - lowPrice24h) / lowPrice24h * 100`
  - `turnover24h >= minTurnover24hUSDT`
  - `vol24hPct >= minVolatility24hPct`
  - top `maxSymbols` by turnover.
- WS subscriptions are rebuilt to the frozen universe only (`tickers + kline.{tfMin}`).

## Symbol status computation
- `IDLE`: missing confirmed candle references (`prevCandleClose`, `prevCandleOivUSDT`) or missing ticker base values.
- `ARMED`: confirmed candle refs exist AND ticker mark/OIV are present.
- `gates.dataReady=false` when funding fields are missing (`fundingRate` or `nextFundingTime`) or ticker data is stale.

## 1Hz aggregation
- Bybit WS ingests continuously into in-memory stores (`MarketStateStore`, `CandleTracker`).
- Backend emits frontend `tick` once per second.
- If a full tick payload exceeds **1MB**, engine logs one non-fatal `error` (`scope=ENGINE_TICK`, `code=PAYLOAD_TOO_LARGE_DELTA_MODE`) and switches to true symbol deltas for subsequent ticks.

## Stability hardening notes
- Session runtime has a deterministic 1Hz scheduler (`tickOnce`) that drives:
  - strategy evaluation,
  - paper broker processing,
  - outbound `tick` aggregation.
- Bybit WS reconnect path emits frontend `error` messages (`scope=BYBIT_WS`, `code=RECONNECTING`) and persists matching `error` events.

## Invariant checks (non-fatal diagnostics)

Engine validates each `SymbolRow` every 1Hz tick via `assertInvariants(symbolState)`.
Violations do **not** crash the process; instead they emit:
- WS `error` message with `scope=ENGINE_INVARIANT`,
- eventlog entry with `type=error` and same code.

Invariant codes:
- `STATUS_ORDER_WITH_POSITION`
  - `status === ORDER_PLACED` while `position != null`.
- `STATUS_POSITION_MISSING`
  - `status === POSITION_OPEN` while `position == null`.
- `ORDER_EXPIRY_BEFORE_PLACED`
  - `order.expiresTs < order.placedTs`.
- `ORDER_QTY_INVALID`
  - `order.qty <= 0` or not finite.
- `POSITION_QTY_INVALID`
  - `position.qty <= 0` or not finite.
- `POSITION_LONG_TP_SL_INVALID`
  - LONG with invalid TP/SL relative to entry (`tp <= entry` or `sl >= entry`).
- `POSITION_SHORT_TP_SL_INVALID`
  - SHORT with invalid TP/SL relative to entry (`tp >= entry` or `sl <= entry`).

Repeated violations are de-duplicated per symbol/code while they remain active.
