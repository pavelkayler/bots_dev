# 10 JSON Schemas (Draft-07)

These schemas are intended for runtime validation (backend) and optional frontend validation.

- Draft: **JSON Schema draft-07**
- Notes:
  - `ts` fields are **milliseconds epoch**.
  - `sessionId` is opaque string.
  - `SymbolRow` is sent in `snapshot.symbols` and `tick.symbolsDelta`.
  - All WS messages include `type` and `ts`.

---

## 1) Common definitions

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/common.json",
  "title": "Common definitions",
  "type": "object",
  "definitions": {
    "SessionState": {
      "type": "string",
      "enum": ["STOPPED", "RUNNING", "COOLDOWN", "STOPPING"]
    },
    "SymbolStatus": {
      "type": "string",
      "enum": ["IDLE", "ARMED", "ORDER_PLACED", "POSITION_OPEN"]
    },
    "OrderSide": {
      "type": "string",
      "enum": ["BUY", "SELL"]
    },
    "PositionSide": {
      "type": "string",
      "enum": ["LONG", "SHORT"]
    },
    "EventType": {
      "type": "string",
      "enum": [
        "session_started",
        "universe_built",
        "cooldown_entered",
        "cooldown_exited",
        "signal_fired",
        "order_placed",
        "order_filled",
        "order_expired",
        "order_canceled",
        "position_opened",
        "position_closed",
        "funding_applied",
        "session_stopped"
      ]
    },
    "TsMs": { "type": "integer", "minimum": 0 },
    "Money": { "type": "number" },
    "Pct": { "type": "number" }
  },
  "additionalProperties": false
}
```

---

## 2) REST: SessionStartRequest

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/rest/sessionStartRequest.json",
  "title": "SessionStartRequest",
  "type": "object",
  "required": ["tfMin", "universe", "signal", "trade", "fundingCooldown", "fees"],
  "properties": {
    "tfMin": { "type": "integer", "enum": [1, 3, 5, 10, 15] },
    "universe": {
      "type": "object",
      "required": ["minVolatility24hPct", "minTurnover24hUSDT", "maxSymbols"],
      "properties": {
        "minVolatility24hPct": { "type": "number", "minimum": 0 },
        "minTurnover24hUSDT": { "type": "number", "minimum": 0 },
        "maxSymbols": { "type": "integer", "minimum": 1 }
      },
      "additionalProperties": false
    },
    "signal": {
      "type": "object",
      "required": ["priceMovePctThreshold", "oivMovePctThreshold"],
      "properties": {
        "priceMovePctThreshold": { "type": "number", "minimum": 0 },
        "oivMovePctThreshold": { "type": "number", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "trade": {
      "type": "object",
      "required": [
        "marginUSDT",
        "leverage",
        "entryOffsetPct",
        "entryOrderTimeoutMin",
        "tpRoiPct",
        "slRoiPct"
      ],
      "properties": {
        "marginUSDT": { "type": "number", "exclusiveMinimum": 0 },
        "leverage": { "type": "number", "exclusiveMinimum": 0 },
        "entryOffsetPct": { "type": "number", "minimum": 0 },
        "entryOrderTimeoutMin": { "type": "number", "exclusiveMinimum": 0 },
        "tpRoiPct": { "type": "number", "exclusiveMinimum": 0 },
        "slRoiPct": { "type": "number", "exclusiveMinimum": 0 }
      },
      "additionalProperties": false
    },
    "fundingCooldown": {
      "type": "object",
      "required": ["beforeMin", "afterMin"],
      "properties": {
        "beforeMin": { "type": "number", "minimum": 0 },
        "afterMin": { "type": "number", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "fees": {
      "type": "object",
      "required": ["makerRate", "takerRate"],
      "properties": {
        "makerRate": { "type": "number", "minimum": 0 },
        "takerRate": { "type": "number", "minimum": 0 }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

---

## 3) REST: SessionStartResponse

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/rest/sessionStartResponse.json",
  "title": "SessionStartResponse",
  "type": "object",
  "required": ["ok", "sessionId", "state"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "sessionId": { "type": "string", "minLength": 1 },
    "state": { "type": "string", "enum": ["RUNNING"] }
  },
  "additionalProperties": false
}
```

---

## 4) REST: SessionStopResponse

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/rest/sessionStopResponse.json",
  "title": "SessionStopResponse",
  "type": "object",
  "required": ["ok", "sessionId", "state"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "sessionId": { "type": "string", "minLength": 1 },
    "state": { "type": "string", "enum": ["STOPPED"] }
  },
  "additionalProperties": false
}
```

---

## 5) REST: SessionStatusResponse

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/rest/sessionStatusResponse.json",
  "title": "SessionStatusResponse",
  "type": "object",
  "required": ["ok", "sessionId", "state", "tfMin", "counts", "cooldown"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "sessionId": { "type": "string", "minLength": 1 },
    "state": { "type": "string", "enum": ["STOPPED", "RUNNING", "COOLDOWN", "STOPPING"] },
    "tfMin": { "type": "integer", "enum": [1, 3, 5, 10, 15] },
    "counts": {
      "type": "object",
      "required": ["symbolsTotal", "ordersActive", "positionsOpen"],
      "properties": {
        "symbolsTotal": { "type": "integer", "minimum": 0 },
        "ordersActive": { "type": "integer", "minimum": 0 },
        "positionsOpen": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "cooldown": {
      "type": "object",
      "required": ["isActive", "untilTs"],
      "properties": {
        "isActive": { "type": "boolean" },
        "untilTs": { "type": ["integer", "null"], "minimum": 0 }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

---

## 6) WS: SymbolRow

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/symbolRow.json",
  "title": "SymbolRow",
  "type": "object",
  "required": ["symbol", "status", "market", "funding", "signalMetrics", "order", "position", "gates"],
  "properties": {
    "symbol": { "type": "string", "minLength": 1 },
    "status": { "type": "string", "enum": ["IDLE", "ARMED", "ORDER_PLACED", "POSITION_OPEN"] },
    "market": {
      "type": "object",
      "required": ["markPrice", "turnover24hUSDT", "volatility24hPct", "oivUSDT"],
      "properties": {
        "markPrice": { "type": "number" },
        "turnover24hUSDT": { "type": "number", "minimum": 0 },
        "volatility24hPct": { "type": "number", "minimum": 0 },
        "oivUSDT": { "type": "number", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "funding": {
      "type": "object",
      "required": ["rate", "nextFundingTimeTs", "nextFundingTimeMsk", "countdownSec"],
      "properties": {
        "rate": { "type": "number" },
        "nextFundingTimeTs": { "type": "integer", "minimum": 0 },
        "nextFundingTimeMsk": { "type": "string" },
        "countdownSec": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "signalMetrics": {
      "type": "object",
      "required": ["prevCandleClose", "prevCandleOivUSDT", "priceMovePct", "oivMovePct"],
      "properties": {
        "prevCandleClose": { "type": "number" },
        "prevCandleOivUSDT": { "type": "number", "minimum": 0 },
        "priceMovePct": { "type": "number" },
        "oivMovePct": { "type": "number" }
      },
      "additionalProperties": false
    },
    "order": {
      "anyOf": [
        { "type": "null" },
        {
          "type": "object",
          "required": ["side", "type", "status", "placedTs", "expiresTs", "price", "qty"],
          "properties": {
            "side": { "type": "string", "enum": ["BUY", "SELL"] },
            "type": { "type": "string", "enum": ["LIMIT"] },
            "status": { "type": "string", "enum": ["OPEN"] },
            "placedTs": { "type": "integer", "minimum": 0 },
            "expiresTs": { "type": "integer", "minimum": 0 },
            "price": { "type": "number" },
            "qty": { "type": "number", "exclusiveMinimum": 0 }
          },
          "additionalProperties": false
        }
      ]
    },
    "position": {
      "anyOf": [
        { "type": "null" },
        {
          "type": "object",
          "required": [
            "side",
            "entryTs",
            "entryPrice",
            "qty",
            "tpPrice",
            "slPrice",
            "fundingAccruedUSDT",
            "feesPaidUSDT",
            "unrealizedPnlUSDT",
            "unrealizedRoiPct"
          ],
          "properties": {
            "side": { "type": "string", "enum": ["LONG", "SHORT"] },
            "entryTs": { "type": "integer", "minimum": 0 },
            "entryPrice": { "type": "number" },
            "qty": { "type": "number", "exclusiveMinimum": 0 },
            "tpPrice": { "type": "number" },
            "slPrice": { "type": "number" },
            "fundingAccruedUSDT": { "type": "number" },
            "feesPaidUSDT": { "type": "number", "minimum": 0 },
            "unrealizedPnlUSDT": { "type": "number" },
            "unrealizedRoiPct": { "type": "number" }
          },
          "additionalProperties": false
        }
      ]
    },
    "gates": {
      "type": "object",
      "required": ["cooldownBlocked", "dataReady"],
      "properties": {
        "cooldownBlocked": { "type": "boolean" },
        "dataReady": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

---

## 7) WS: EventRow

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/eventRow.json",
  "title": "EventRow",
  "type": "object",
  "required": ["id", "ts", "type", "symbol", "data"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "ts": { "type": "integer", "minimum": 0 },
    "type": { "type": "string" },
    "symbol": { "type": ["string", "null"] },
    "data": { "type": "object" }
  },
  "additionalProperties": false
}
```

---

## 8) WS: Messages

### 8.1 hello

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/hello.json",
  "title": "WsHello",
  "type": "object",
  "required": ["type", "ts", "protocolVersion", "server"],
  "properties": {
    "type": { "type": "string", "const": "hello" },
    "ts": { "type": "integer", "minimum": 0 },
    "protocolVersion": { "type": "integer", "const": 1 },
    "server": {
      "type": "object",
      "required": ["name", "env"],
      "properties": {
        "name": { "type": "string" },
        "env": { "type": "string" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 8.2 snapshot

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/snapshot.json",
  "title": "WsSnapshot",
  "type": "object",
  "required": ["type", "ts", "session", "config", "counts", "cooldown", "universe", "symbols", "eventsTail"],
  "properties": {
    "type": { "type": "string", "const": "snapshot" },
    "ts": { "type": "integer", "minimum": 0 },
    "session": {
      "type": "object",
      "required": ["sessionId", "state", "tfMin"],
      "properties": {
        "sessionId": { "type": "string", "minLength": 1 },
        "state": { "type": "string", "enum": ["STOPPED", "RUNNING", "COOLDOWN", "STOPPING"] },
        "tfMin": { "type": "integer", "enum": [1, 3, 5, 10, 15] }
      },
      "additionalProperties": false
    },
    "config": { "$ref": "https://local/bybit-paper-bot/schemas/rest/sessionStartRequest.json" },
    "counts": {
      "type": "object",
      "required": ["symbolsTotal", "ordersActive", "positionsOpen"],
      "properties": {
        "symbolsTotal": { "type": "integer", "minimum": 0 },
        "ordersActive": { "type": "integer", "minimum": 0 },
        "positionsOpen": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "cooldown": {
      "type": "object",
      "required": ["isActive", "reason", "fromTs", "untilTs"],
      "properties": {
        "isActive": { "type": "boolean" },
        "reason": { "type": ["string", "null"] },
        "fromTs": { "type": ["integer", "null"], "minimum": 0 },
        "untilTs": { "type": ["integer", "null"], "minimum": 0 }
      },
      "additionalProperties": false
    },
    "universe": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    },
    "symbols": {
      "type": "array",
      "items": { "$ref": "https://local/bybit-paper-bot/schemas/ws/symbolRow.json" }
    },
    "eventsTail": {
      "type": "array",
      "items": { "$ref": "https://local/bybit-paper-bot/schemas/ws/eventRow.json" }
    }
  },
  "additionalProperties": false
}
```

### 8.3 tick (1Hz)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/tick.json",
  "title": "WsTick",
  "type": "object",
  "required": ["type", "ts", "session", "counts", "cooldown", "symbolsDelta"],
  "properties": {
    "type": { "type": "string", "const": "tick" },
    "ts": { "type": "integer", "minimum": 0 },
    "session": {
      "type": "object",
      "required": ["sessionId", "state"],
      "properties": {
        "sessionId": { "type": "string", "minLength": 1 },
        "state": { "type": "string", "enum": ["STOPPED", "RUNNING", "COOLDOWN", "STOPPING"] }
      },
      "additionalProperties": false
    },
    "counts": {
      "type": "object",
      "required": ["symbolsTotal", "ordersActive", "positionsOpen"],
      "properties": {
        "symbolsTotal": { "type": "integer", "minimum": 0 },
        "ordersActive": { "type": "integer", "minimum": 0 },
        "positionsOpen": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "cooldown": {
      "type": "object",
      "required": ["isActive", "reason", "fromTs", "untilTs"],
      "properties": {
        "isActive": { "type": "boolean" },
        "reason": { "type": ["string", "null"] },
        "fromTs": { "type": ["integer", "null"], "minimum": 0 },
        "untilTs": { "type": ["integer", "null"], "minimum": 0 }
      },
      "additionalProperties": false
    },
    "symbolsDelta": {
      "type": "array",
      "items": { "$ref": "https://local/bybit-paper-bot/schemas/ws/symbolRow.json" }
    }
  },
  "additionalProperties": false
}
```

### 8.4 events_append

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/eventsAppend.json",
  "title": "WsEventsAppend",
  "type": "object",
  "required": ["type", "ts", "sessionId", "events"],
  "properties": {
    "type": { "type": "string", "const": "events_append" },
    "ts": { "type": "integer", "minimum": 0 },
    "sessionId": { "type": "string", "minLength": 1 },
    "events": {
      "type": "array",
      "items": { "$ref": "https://local/bybit-paper-bot/schemas/ws/eventRow.json" }
    }
  },
  "additionalProperties": false
}
```

### 8.5 session_state

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/sessionState.json",
  "title": "WsSessionState",
  "type": "object",
  "required": ["type", "ts", "sessionId", "state", "cooldown"],
  "properties": {
    "type": { "type": "string", "const": "session_state" },
    "ts": { "type": "integer", "minimum": 0 },
    "sessionId": { "type": "string", "minLength": 1 },
    "state": { "type": "string", "enum": ["STOPPED", "RUNNING", "COOLDOWN", "STOPPING"] },
    "cooldown": {
      "type": "object",
      "required": ["isActive", "reason", "fromTs", "untilTs"],
      "properties": {
        "isActive": { "type": "boolean" },
        "reason": { "type": ["string", "null"] },
        "fromTs": { "type": ["integer", "null"], "minimum": 0 },
        "untilTs": { "type": ["integer", "null"], "minimum": 0 }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 8.6 error

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local/bybit-paper-bot/schemas/ws/error.json",
  "title": "WsError",
  "type": "object",
  "required": ["type", "ts", "sessionId", "scope", "code", "message", "data"],
  "properties": {
    "type": { "type": "string", "const": "error" },
    "ts": { "type": "integer", "minimum": 0 },
    "sessionId": { "type": "string", "minLength": 1 },
    "scope": { "type": "string" },
    "code": { "type": "string" },
    "message": { "type": "string" },
    "data": { "type": "object" }
  },
  "additionalProperties": false
}
```
