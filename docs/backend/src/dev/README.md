# Self-check harness

Offline deterministic harness for validating strategy + paper execution loop without Bybit connectivity.

## Run

```bash
npm run selfcheck
npm run selfcheck -- --all
npm run selfcheck -- --scenario=long_happy.json
FEED_MODE=sim SCENARIO=short_happy.json npm run selfcheck
```

## Scenario format

Place JSON files in `backend/testdata/scenarios/*.json`.

Required top-level fields:

- `name`, `baseTs`, `tfMin`, `ticks`, `symbols`
- `instrumentSpecs` by symbol
- `config` (same session config shape)
- `expected.majorSequence` (ordered event type checkpoints)
- `frames[]` with:
  - `t` (second offset)
  - `tickers` patch map (same ticker canonical fields)
  - optional `klines` with `{symbol, tfMin, candle}` where `candle.confirm=true` updates candle refs

## Assertions performed

- major event ordering
- no duplicate order placement while order/position active
- 1-second re-arm after close/expiry/cancel
- TP => positive ROI, SL => negative ROI
- JSONL event log line count equals emitted events count
