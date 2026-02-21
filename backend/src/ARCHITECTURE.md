# Backend architecture (Task #11)

This refactor keeps runtime behavior and DTO contracts unchanged while clarifying module boundaries.

## 1Hz pipeline (single scheduler)
`engine/SessionManager.ts` owns the only interval (`setInterval`, 1000ms) and runs this fixed order per tick:
1. Read feed patches already merged into stores (`MarketStateStore`, `CandleTracker`).
2. Evaluate funding cooldown gate (`FundingCooldownGate`).
3. Evaluate strategy intents (`StrategyEngine`) when cooldown is inactive.
4. Advance paper execution (`PaperBroker` fills/expiries/exits/funding), then place newly approved entry orders.
5. Rebuild DTO rows and broadcast WS `tick`.
6. Flush/batch event logging through `EventLogger` queue + stream backpressure.

## Module responsibilities
- `bybit/`: external Bybit REST+WS transport and parsing into normalized market primitives.
- `feed/`: feed adapters (`BybitFeed`, `SimFeed`) exposing `MarketFeed` interface.
- `engine/`: state stores, cooldown gate, pure strategy logic, and session orchestration.
- `paper/`: stateful paper execution, order/position models, rounding/fees/funding helpers.
- `logging/`: JSONL event logger with bounded queue handling.
- `api/`: REST routes and frontend WS broadcast hub.
- `types/`: typed cross-module surfaces (`dto.ts`, `engine.ts`, `paper.ts`).

## Data flow diagram
```text
Bybit WS/REST
   │
   ▼
bybit/* parser/transport
   │
   ▼
feed/* adapters ─────────────┐
                             ▼
                   engine/MarketStateStore + CandleTracker
                             ▼
                  engine/SessionManager (1Hz orchestrator)
                     ├─ StrategyEngine (decisions)
                     ├─ FundingCooldownGate
                     ├─ PaperBroker
                     ├─ logging/EventLogger
                     └─ api/wsHub + api/http
```

## Lifecycle/state-machine references
- Session lifecycle: `docs/05_state_machines.md` (STOPPED/RUNNING/COOLDOWN/STOPPING).
- Symbol lifecycle: `docs/05_state_machines.md` (IDLE/ARMED/ORDER_PLACED/POSITION_OPEN).

## Migration note
- DTO payload shapes are unchanged (`api/dto.ts` remains source schema).
- Internal type imports should use `src/types/*` re-exports instead of importing across feature modules directly.
- WS error `code` values are now standardized constants (same string values as before).
