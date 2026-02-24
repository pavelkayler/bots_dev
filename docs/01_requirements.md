# 01 Requirements & Constraints

Last update: 2026-02-24

## Product goal
Build a controllable **Bybit USDT‑margined perpetual (linear)** bot skeleton with:
- **runtime session control** (start/stop/status)
- **market cache + metrics + signals**
- **paper execution** (simulated fills, TP/SL by ROI, fees, funding)
- **operator UI** (Dashboard) to observe rows, events, summary

## Hard constraints
- Instruments: **USDT perpetual (linear), Trading only**.
- Market data source: **Bybit V5 Public WebSocket** for tickers and klines.
  - One REST use is allowed **only for symbol seed** (instrument list), to avoid subscribing to nonexistent symbols.
- Frontend architecture stays modular:
  - `src/app`, `src/pages`, `src/features`, `src/shared`
- Backend: Node.js ESM, TypeScript strict; avoid breaking `exactOptionalPropertyTypes`.

## Operator workflow (v1)
1. Create a Universe on `/universe` using filters:
   - `minTurnover24h` (USD) and `minVolatility24h` (%)
2. On Dashboard:
   - select Universe in Config (dropdown), Apply
   - connect WS streams, verify live rows update
   - Start / Stop session
   - inspect Events tail and download JSONL
   - inspect Summary after Stop

## Non-goals (current phase)
- Demo/Real trading (only paper).
- Auto-optimization / auto-runs.
- Preset management UX (naming, delete, versions). We keep Universes as saved sets only.
