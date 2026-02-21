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
- `gates.dataReady=false` when funding fields are missing (`fundingRate` or `nextFundingTime`).
- `order` and `position` are always `null` in this task.

## 1Hz aggregation
- Bybit WS ingests continuously into in-memory stores (`MarketStateStore`, `CandleTracker`).
- Backend emits frontend `tick` exactly once per second.
- For this stage, each 1Hz `tick` includes all universe rows in `symbolsDelta`.
- Price/OIV movement fields are recomputed on each 1Hz emission from the latest ticker values and last confirmed candle references.

## Stability hardening notes (Task #7)
- Session runtime now has a single deterministic 1Hz scheduler (`tickOnce`) that drives:
  - strategy evaluation,
  - paper broker processing,
  - outbound `tick` aggregation.
- Market data freshness is now gated:
  - each symbol tracks last ticker update time,
  - if data is stale for more than 5 seconds, `gates.dataReady=false`,
  - stale symbols remain visible in table output but are not armed for trading.
- Bybit WS reconnect path emits frontend `error` messages (`scope=BYBIT_WS`, `code=RECONNECTING`) and persists matching `error` events.
