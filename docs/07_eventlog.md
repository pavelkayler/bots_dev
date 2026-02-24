# 07 Eventlog (JSONL) — canonical event payloads

Last update: 2026-02-24

File:
- `backend/data/sessions/<sessionId>/events.jsonl`

Transport:
- on connect, server sends tail as `events_tail`
- new events stream as `events_append`

Event line structure:
```json
{ "ts": 1719410110000, "type": "ORDER_PLACED", "symbol": "BTCUSDT", "payload": { ... } }
```

Common event types (paper):
- `SESSION_START`, `SESSION_STOP`
- `ORDER_PLACED`, `ORDER_FILLED`, `ORDER_CANCELED`, `ORDER_EXPIRED`
- `POSITION_OPEN`
- `POSITION_CLOSE_TP`, `POSITION_CLOSE_SL`, `POSITION_FORCE_CLOSE`

Notes:
- UI may display only last N events (tail). Full history is always in JSONL.
