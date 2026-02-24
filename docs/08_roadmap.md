# 08 Roadmap

Last update: 2026-02-24

Legend:
- ✅ done
- 🟡 in progress
- ⏳ planned

## Phase A — Core skeleton
- ✅ Backend Fastify + WS `/ws`
- ✅ Market cache (tickers + kline refs)
- ✅ SignalEngine with reasons
- ✅ PaperBroker with JSONL logging
- ✅ Session API start/stop/status
- ✅ Events via WS (tail + append)
- ✅ Dashboard базовая панель

## Phase B — Universes
- ✅ Universe Builder page (/universe)
- ✅ REST seed list of Trading symbols (only to seed WS subscriptions)
- ✅ WS-based filtering by turnover + volatility, save to `data/universes/*.json`
- ✅ Config: select Universe via dropdown and apply to runtime config

## Phase C — LiveRows reliability
- 🟡 Fix LiveRows empty/non-updating when cache fields are partial.
  Target: rows are built from Universe symbol list; cache fields may be 0/empty until filled.
- 🟡 Ensure ActiveOnly filters to active symbols (paper open/pending and signals)

## Phase D — Server-side bot stats
- ⏳ Move Bot summary stats calculation to server and push via WS snapshot/tick (survive frontend reload).
- ⏳ Persist per-session stats to summary.

## Phase E — Export pack
- ⏳ One-click download of run pack: events.jsonl + summary.json + runtime config snapshot.
