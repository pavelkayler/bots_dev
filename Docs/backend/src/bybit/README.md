# Bybit data sources layer (Task #1)

## Endpoints used
- Public WebSocket V5 (linear): `wss://stream.bybit.com/v5/public/linear`
- Market REST V5: `GET https://api.bybit.com/v5/market/instruments-info?category=linear`

## Topics used
- `tickers.{symbol}`
- `kline.{tfMin}.{symbol}`

## Batching + multi-connection behavior
- Topics are built for each symbol as two entries (`tickers` + `kline`).
- Topics are split by an args-length cap (`21_000` chars by default).
- Each partition is assigned to its own WS connection (a shard).
- Each shard reconnects independently using exponential backoff and resubscribes with the same topic set.

## Runtime behavior notes
- Ticker stream is snapshot+delta. The client keeps in-memory last ticker state by symbol and merges new patches.
- Heartbeat ping is sent every ~20s per connection.

## Smoke test
Run with your TypeScript runner (e.g. `tsx`):

```bash
cd backend
npx tsx src/bybit/smoke.ts
```

The smoke script:
1) Fetches linear instruments info.
2) Connects WS.
3) Subscribes to BTCUSDT and ETHUSDT for ticker + 5m kline.
4) Prints parsed samples to console.
