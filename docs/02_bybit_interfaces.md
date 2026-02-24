# 02 Bybit Data Interfaces (V5)

Last update: 2026-02-24

## 1) Public WebSocket (primary)
Endpoint:
- `wss://stream.bybit.com/v5/public/linear`

Topics used:
- `tickers.<symbol>` — 24h stats and funding fields used for filtering and runtime rows
- `kline.<tfMin>.<symbol>` — candle boundaries (`confirm=true`) used to create **reference points**

Notes:
- Ticker payload can arrive as **object or array**; implementation must normalize both.
- Funding fields vary by instrument. Use per-symbol values provided in ticker:
  - `fundingRate`
  - `nextFundingTime`
  - optional `fundingIntervalHour` (if present)

## 2) REST (allowed only as symbol seed)
Purpose: get the list of **Trading** instruments to subscribe via WS (avoid garbage symbols).

Endpoint:
- `GET https://api.bybit.com/v5/market/instruments-info?category=linear&status=Trading&limit=...&cursor=...`

Filtering rules after seed:
- symbol matches `^[A-Z0-9]{2,28}USDT$`
- exclude symbols containing `-`
- prefer `contractType` containing `perpetual`
- `settleCoin == USDT` if field exists

The seed list is used ONLY to build WS subscriptions. All metrics/filters are computed from WS tickers.
