# 08 Roadmap

Last update: 2026-02-25

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
- ✅ Summary computation + download

## Phase B — Universes + ops UI
- ✅ Universe Builder page (/universe)
- ✅ WS-based filtering by turnover + volatility, save to `data/universes/*.json`
- ✅ Config: select Universe via dropdown and apply to runtime config
- ✅ Universe delete with “in use” protection (409)

## Phase C — Dashboard operator UX
- ✅ LiveRows table wired correctly (ActiveOnly filtering works)
- ✅ LiveRows header controls: ActiveOnly + rows count + Next candle countdown + Refresh rows
- ✅ Bot stats via WS snapshot/tick + uptime display
- ✅ Trade stats by symbol (real-time; sortable)
- ✅ Events tail limit selector (5/25/50/100)
- ✅ Summary resets on Start; trades table global sort + pagination (50/100/200)
- ✅ Fees displayed as negative values (UI)

## Phase D — Config ergonomics
- ✅ Numeric inputs allow empty while typing; Apply validates
- ✅ Apply gating (dirty + valid + universe selected) + Apply & Reboot (stop+start without summary flash)
- ✅ Presets (select / overwrite save / remove) + preferred universe auto-select
- ✅ Direction mode: both / long / short (default both), applied to signals + trading

## Phase E — Next steps (planned)
See: `docs/20_future_plan.md`
