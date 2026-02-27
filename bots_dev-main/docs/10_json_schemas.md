# 10 JSON Schemas (Draft-07)

Last update: 2026-02-24

This document describes the main persisted JSON formats.

## 1) Universe file
Path:
- `backend/data/universes/<id>.json`

Shape:
```json
{
  "meta": {
    "id": "10m_10pct",
    "name": "10m/10%",
    "minTurnoverUsd": 10000000,
    "minVolatilityPct": 10,
    "createdAt": 1719410000000,
    "updatedAt": 1719410000000,
    "count": 96
  },
  "symbols": ["BTCUSDT", "ETHUSDT"]
}
```

## 2) Events JSONL
Path:
- `backend/data/sessions/<sessionId>/events.jsonl`

Each line:
```json
{ "ts": 1719410110000, "type": "ORDER_PLACED", "symbol": "BTCUSDT", "payload": {} }
```

## 3) Summary JSON
Path:
- `backend/data/sessions/<sessionId>/summary.json`

Shape (high level):
- aggregated trades stats + per-trade list
