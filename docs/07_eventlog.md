# 07 Eventlog (JSONL) — canonical event payloads

Last update: 2026-02-25

File:
- `backend/data/sessions/<sessionId>/events.jsonl`

Transport (WS `/ws`):
- on connect, server sends tail as `events_tail`
- new events stream as `events_append`
- UI tail limit is operator-selectable: **5 / 25 / 50 / 100**

Event line structure:
```json
{
  "ts": 1719410110000,
  "type": "ORDER_PLACED",
  "symbol": "BTCUSDT",
  "payload": { ... }
}
```

Common event types (paper):
- `SESSION_START`, `SESSION_STOP`
- `SESSION_STATE`
- `ORDER_PLACED`, `ORDER_FILLED`, `ORDER_CANCELED`, `ORDER_EXPIRED`
- `POSITION_OPEN`
- `POSITION_CLOSE_TP`, `POSITION_CLOSE_SL`, `POSITION_FORCE_CLOSE`

Notes:
- UI may display only the last N events (tail). Full history is always in JSONL.
