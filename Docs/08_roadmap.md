# 08 Roadmap (v1 → v1.1)

## Phase 0 — Repo bootstrap
- Create monorepo layout: /backend and /frontend
- Decide TS on backend (recommended)
- Add shared lint/format (optional but recommended): ESLint + Prettier
Deliverable: project starts locally, FE connects to BE WS.

## Phase 1 — Backend skeleton (local API/WS)
- Fastify server:
  - REST: /api/session/start, /api/session/stop, /api/session/status
  - WS: /ws streaming hello + snapshot + tick + events_append
- In-memory session object with dummy data at 1Hz
Deliverable: UI renders pages with live dummy stream.

## Phase 2 — Bybit connectivity (WS ingestion)
- Implement BybitWsClient:
  - connect to public linear endpoint
  - ping/pong heartbeat
  - reconnect + resubscribe
  - batching/multi-connection by args-length limit
- Subscribe to one symbol tickers + one symbol kline (smoke test)
Deliverable: backend receives and stores tickers/kline.

## Phase 3 — Bootstrap instruments (REST start-only)
- On session start:
  - call instruments-info category=linear
  - build symbol catalog with tick/qty/minQty
Deliverable: exchange-like rounding possible.

## Phase 4 — Universe builder (start-only, WS tickers)
- Subscribe tickers for all candidate symbols
- Wait short warm-up window (e.g., 3–5 seconds) to collect 24h stats
- Filter by:
  - vol24h = (high24h - low24h) / low24h * 100
  - turnover24h >= threshold
- Limit to maxSymbols
- Freeze universe for rest of session
Deliverable: stable list of tradable symbols.

## Phase 5 — CandleTracker + reference snapshots
- Subscribe kline.{tf}.{symbol} for universe
- On confirm=true:
  - set prevCandleClose
  - sample prevCandleOivClose from last ticker state
- Mark symbol as ARMED when both references exist
Deliverable: consistent "close boundary" references.

## Phase 6 — Strategy engine (1Hz)
- Global funding gate:
  - compute cooldown windows from nextFundingTime
  - if active: session state COOLDOWN; skip evaluation
- For each symbol ARMED:
  - compute priceMovePct and oivMovePct using markNow and OIV now
  - apply strict LONG/SHORT rules
  - if pass: place paper limit order with offset+timeout
Deliverable: signals trigger orders.

## Phase 7 — PaperBroker (orders+positions)
- Order lifecycle:
  - placed -> touch-fill or expire
- Position lifecycle:
  - open -> TP/SL touch close
- Fees:
  - base maker fee applied at fill/close
- Funding:
  - apply payment at funding ts
- 1-second re-arm delay after cycle end
Deliverable: full cycle produces realized trades.

## Phase 8 — Eventlog JSONL
- Implement EventLogger:
  - session file per run
  - append-only JSONL
- Emit canonical events (see 07_eventlog.md)
- Stream events_append to UI
Deliverable: reproducible run history.

## Phase 9 — Frontend UI (final v1)
Pages:
- /config: full config, Start
- /runtime: session state + Stop + counters + global funding timer
- /symbols: big table with per-symbol state, mark, priceMove%, oiv, oivMove%, funding next (MSK), countdown
- /events: event tail table with filters
Performance:
- 1Hz rendering; optionally virtualize SymbolsTable for >300 rows

## Phase 10 — STOP semantics
- On STOP:
  - cancel orders
  - close positions
  - emit final snapshot/session_state STOPPED
  - freeze symbol table updates (frontend shows last snapshot)
Deliverable: deterministic stop behavior.

---

## v1.1 (optional next)
- Per-symbol "data stale" detection
- Better batching strategy and multiple WS connections by symbol count
- Persist a compact session summary JSON beside events.jsonl
- Manual "close all" and "cancel all" controls
