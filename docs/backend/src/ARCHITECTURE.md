# Backend architecture

Last update: 2026-02-24

## Modules
- `src/runtime`
  - session orchestration, start/stop/status
  - config store (Zod-validated, persisted)
- `src/bybit`
  - WS client(s) for tickers and klines
- `src/engine`
  - market cache (tickers)
  - candle tracker (kline confirm)
  - signal engine and funding cooldown gate
- `src/paper`
  - paper broker: orders/positions/fees/funding
  - summary builder from JSONL
- `src/api`
  - REST routes
  - WS hub (`/ws`) for pushing rows/events/state to UI

## Data persistence
- `data/sessions/<sessionId>/events.jsonl`
- `data/sessions/<sessionId>/summary.json` (when generated)
- `data/universes/<id>.json`
