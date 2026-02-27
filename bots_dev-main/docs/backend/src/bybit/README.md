# Bybit data sources layer

Last update: 2026-02-24

## Upstream connections
- Public linear WS:
  - tickers and kline streams for runtime universe
- Universe Builder:
  - REST seed instruments list (Trading only)
  - one-off WS subscription to tickers for seed symbols, then filtering

## Practical concerns
- Subscription batching is required for large universes.
- Ticker payload normalization is required (array vs object).
