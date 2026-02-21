# 06 Frontend ↔ Backend Contracts (REST + WS)

This document is the definitive DTO contract.

## 1. REST API
### POST /api/session/start
Request DTO: SessionStartRequest
```json
{
  "tfMin": 5,
  "universe": {
    "minVolatility24hPct": 5,
    "minTurnover24hUSDT": 1000000,
    "maxSymbols": 200
  },
  "signal": {
    "priceMovePctThreshold": 0.8,
    "oivMovePctThreshold": 2.0
  },
  "trade": {
    "marginUSDT": 100,
    "leverage": 10,
    "entryOffsetPct": 0.15,
    "entryOrderTimeoutMin": 10,
    "tpRoiPct": 5,
    "slRoiPct": 3
  },
  "fundingCooldown": {
    "beforeMin": 15,
    "afterMin": 10
  },
  "fees": {
    "makerRate": 0.0001,
    "takerRate": 0.0006
  }
}
```

Response DTO: SessionStartResponse
```json
{ "ok": true, "sessionId": "2026-02-20T12-34-56Z_ab12cd", "state": "RUNNING" }
```

### POST /api/session/stop
Response DTO:
```json
{ "ok": true, "sessionId": "2026-02-20T12-34-56Z_ab12cd", "state": "STOPPED" }
```

### GET /api/session/status
Response DTO:
```json
{
  "ok": true,
  "sessionId": "2026-02-20T12-34-56Z_ab12cd",
  "state": "RUNNING",
  "tfMin": 5,
  "counts": { "symbolsTotal": 187, "ordersActive": 3, "positionsOpen": 2 },
  "cooldown": { "isActive": false, "untilTs": null }
}
```

## 2. WebSocket: ws://localhost:<port>/ws
All messages include:
- type: string
- ts: number (ms epoch)

### 2.1 hello
```json
{
  "type": "hello",
  "ts": 1760954100000,
  "protocolVersion": 1,
  "server": { "name": "bybit-paper-bot", "env": "local" }
}
```

### 2.2 snapshot
Full state for first render.
```json
{
  "type": "snapshot",
  "ts": 1760954100500,
  "session": { "sessionId": "2026-02-20T12-34-56Z_ab12cd", "state": "RUNNING", "tfMin": 5 },
  "config": { "...": "same as SessionStartRequest" },
  "counts": { "symbolsTotal": 187, "ordersActive": 0, "positionsOpen": 0 },
  "cooldown": { "isActive": false, "reason": null, "fromTs": null, "untilTs": null },
  "universe": ["BTCUSDT", "ETHUSDT"],
  "symbols": [ "SymbolRow (see below)" ],
  "eventsTail": [ "EventRow (optional tail)" ]
}
```

### 2.3 tick (1Hz)
Delta updates (full rows for changed symbols).
```json
{
  "type": "tick",
  "ts": 1760954101500,
  "session": { "sessionId": "2026-02-20T12-34-56Z_ab12cd", "state": "RUNNING" },
  "counts": { "symbolsTotal": 187, "ordersActive": 1, "positionsOpen": 0 },
  "cooldown": { "isActive": false, "reason": null, "fromTs": null, "untilTs": null },
  "symbolsDelta": [ "SymbolRow" ]
}
```

### 2.4 events_append
```json
{
  "type": "events_append",
  "ts": 1760954101600,
  "sessionId": "2026-02-20T12-34-56Z_ab12cd",
  "events": [ "EventRow" ]
}
```

### 2.5 session_state
```json
{
  "type": "session_state",
  "ts": 1760956799000,
  "sessionId": "2026-02-20T12-34-56Z_ab12cd",
  "state": "COOLDOWN",
  "cooldown": { "isActive": true, "reason": "FUNDING_WINDOW", "fromTs": 1760956500000, "untilTs": 1760957400000 }
}
```

### 2.6 error
```json
{
  "type": "error",
  "ts": 1760954102000,
  "sessionId": "2026-02-20T12-34-56Z_ab12cd",
  "scope": "BYBIT_WS",
  "code": "RECONNECTING",
  "message": "Disconnected from Bybit public WS; reconnect scheduled.",
  "data": { "attempt": 3 }
}
```

## 3. Shared DTO definitions

### 3.1 Enums
SessionState:
- STOPPED | RUNNING | COOLDOWN | STOPPING

SymbolStatus:
- IDLE | ARMED | ORDER_PLACED | POSITION_OPEN

OrderSide:
- BUY | SELL

EventType (minimum):
- session_started
- universe_built
- cooldown_entered
- cooldown_exited
- signal_fired
- order_placed
- order_filled
- order_expired
- order_canceled
- position_opened
- position_closed
- funding_applied
- session_stopped

### 3.2 SymbolRow
```json
{
  "symbol": "BTCUSDT",
  "status": "ARMED",
  "market": {
    "markPrice": 68012.5,
    "turnover24hUSDT": 123456789.12,
    "volatility24hPct": 6.3,
    "oivUSDT": 98765432.1
  },
  "funding": {
    "rate": 0.0001,
    "nextFundingTimeTs": 1760956800000,
    "nextFundingTimeMsk": "2026-02-20 20:00:00 MSK",
    "countdownSec": 2700
  },
  "signalMetrics": {
    "prevCandleClose": 67980.0,
    "prevCandleOivUSDT": 98500000.0,
    "priceMovePct": 0.048,
    "oivMovePct": 0.27
  },
  "order": null,
  "position": null,
  "gates": { "cooldownBlocked": false, "dataReady": true }
}
```

Order (optional):
```json
{
  "side": "BUY",
  "type": "LIMIT",
  "status": "OPEN",
  "placedTs": 1760954101200,
  "expiresTs": 1760954701200,
  "price": 67888.0,
  "qty": 0.0147
}
```

Position (optional):
```json
{
  "side": "LONG",
  "entryTs": 1760954120000,
  "entryPrice": 67888.0,
  "qty": 0.0147,
  "tpPrice": 68227.4,
  "slPrice": 67684.3,
  "fundingAccruedUSDT": -0.12,
  "feesPaidUSDT": 0.85,
  "unrealizedPnlUSDT": 1.23,
  "unrealizedRoiPct": 1.23
}
```

### 3.3 EventRow
```json
{
  "id": "evt_00000123",
  "ts": 1760954101200,
  "type": "signal_fired",
  "symbol": "BTCUSDT",
  "data": { "any": "type-specific payload" }
}
```
