# 18 Stability & long-run operations

Last update: 2026-03-06

This document describes stability mechanisms intended for multi-hour and multi-day runs.

## Low disk guard
- Threshold: **2GB** free in the backend data directory.
- Exposed via `/api/doctor` as `dataDirBytesFree` with `low_disk` warning.
- Behavior:
  - Optimizer checkpoint writes are skipped on low disk (job message is appended).

## Optimizer isolation
- Optimizer heavy compute runs in a worker thread.
- Main server remains responsive to UI polling and session runtime.

## Soak snapshots
- While runtime session is RUNNING, backend appends a JSON line every 60 seconds:
  - `backend/data/soak_snapshots.jsonl`
- `/api/soak/last` returns the last snapshot cached in memory.

## Risk limits and emergency stop
Runtime-enforced limits are configured in `riskLimits`:
- `maxTradesPerDay`
- `maxLossPerDayUsdt` (`null` disables)
- `maxLossPerSessionUsdt` (`null` disables)
- `maxConsecutiveErrors`

Enforcement behavior:
- `maxTradesPerDay` is counted on actual opened entries (`ORDER_FILLED` / `POSITION_OPEN` / `DEMO_POSITION_OPEN`) rather than placement attempts.
- Before new entry placement, runtime blocks entries when `maxTradesPerDay` is reached and logs `ORDER_SKIPPED` once per symbol/day.
- Runtime tracks realized PnL from close/execution events and compares against daily/session loss thresholds.
- Runtime tracks consecutive critical demo order errors.
- On threshold breach, runtime triggers `EMERGENCY_STOP`, sets runtime status message `Emergency stop: <reason>`, and initiates the hardened STOP flow.
- Emergency-stop is sticky inside the same run lifecycle: status reason remains visible after stop and trading/resume is blocked until a clean new start/reset cycle.

Recommended soak procedure:
1) Start session and let it run for 24h.
2) Periodically check `/api/doctor` warnings and soak snapshot file growth.
3) Verify no emergency-stop message appears unless a risk threshold is intentionally tested.
