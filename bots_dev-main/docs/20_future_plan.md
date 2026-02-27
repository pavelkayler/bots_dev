# 20 Future plan (next chat backlog)

Last update: 2026-02-25

This file is intentionally written as an actionable backlog for the next chat.

## Priority 0 — Make builds green
- Fix TypeScript build errors in backend and frontend (currently failing in some environments).
- After builds are stable, add a minimal CI script (optional).

## Priority 1 — Optimizer hardening
- Persist optimizer jobs/results to disk so a backend restart does not lose the last run.
- Add job cancellation.
- Add results export (CSV/JSON) and a small “run manifest” (tapeIds + ranges + precision + seed + candidates).
- Add a retention policy for tapes (optional): max files / max total size.

## Priority 2 — Reliability + observability
- Add unit tests:
  - config validation/normalization (incl. requireFundingSign enforcement)
  - wsHub message typing contract (snapshot/tick/events)
  - paper broker accounting invariants (fees/funding sign, realized/unrealized)
- Add a “run pack” export:
  - events.jsonl
  - summary.json
  - applied config snapshot (including universe symbol list)

## Priority 3 — Performance
- Worker threads for optimizer runner (optional). Current yielding keeps server responsive, but workers would isolate CPU fully.
- Frontend: ensure heavy dashboard tables render only when visible.

## Priority 4 — Strategy iteration tools
- Add per-signal counters (how many LONG/SHORT generated, blocked by direction, blocked by cooldown).
- Add a lightweight “why no trade” breakdown panel (aggregated reason counts).

## Priority 5 — Functional expansion (later)
- Real demo/real execution connectors (after paper stability).
- Multi-strategy modules (Lead-Lag, momentum, etc.) reusing this skeleton.
