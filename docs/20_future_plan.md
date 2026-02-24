# 20 Future plan (next chat backlog)

Last update: 2026-02-25

This file is intentionally written as an actionable backlog for the next chat.

## Priority 0 — Make builds green
- Fix TypeScript build errors in backend and frontend (currently failing in some environments).
- Add a minimal CI script (optional) once builds are stable.

## Priority 1 — Reliability + observability
- Add unit tests:
  - config validation/normalization (incl. directionMode migration)
  - wsHub message typing contract (snapshot/tick/events)
  - paper broker accounting invariants (fees/funding sign, realized/unrealized)
- Add a “run pack” export:
  - events.jsonl
  - summary.json
  - applied config snapshot (including universe symbol list)
  - (optional) universe meta

## Priority 2 — Strategy iteration tools
- Add per-signal counters (how many LONG/SHORT generated, blocked by direction, blocked by cooldown).
- Add a lightweight “why no trade” breakdown panel (aggregated reason counts).

## Priority 3 — Performance
- Ensure frontend renders only the active page data (avoid heavy updates on hidden tabs).
- WS message throttling / batching where useful (without breaking 1Hz LiveRows semantics).

## Priority 4 — Functional expansion (later)
- Real demo/real execution connectors (after paper stability).
- Multi-strategy modules (Lead-Lag, momentum, etc.) reusing this skeleton.
