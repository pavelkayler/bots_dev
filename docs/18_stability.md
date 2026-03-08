# 18 Stability & long-run operations

Last update: 2026-03-08

This document describes stability mechanisms intended for multi-hour and multi-day runs.

## Low disk guard
- Threshold: **2GB** free in the backend data directory.
- Exposed via `/api/doctor` as `dataDirBytesFree` with `low_disk` warning.
- Behavior:
  - Optimizer checkpoint writes are skipped on low disk (job message is appended).

## Optimizer isolation
- Optimizer heavy compute runs in a worker thread.
- Main server remains responsive to UI polling and session runtime.
- Follow Tail mode is window-stable:
  - `timeRangeFromTs` is fixed from operator input
  - `timeRangeToTs` is re-resolved to current time on each run start
  - temporary stale `timeRangeToTs` values from payload are not trusted
- Multi-bot isolation hardening:
  - optimizer history is filtered by bot id on backend and frontend
  - legacy history rows without bot id map to default OI bot only
  - optimizer localStorage state is bot-scoped to prevent cross-bot UI bleed
  - Signal Bot page does not force global bot selection, preventing cross-page config selection races

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

## Runtime apply semantics
- Config apply during active runtime uses "next trades only" semantics for trading parameters.
- Existing open positions/orders are not force-repriced or force-rebuilt by apply.
- New values are consumed by subsequent entry attempts after apply is acknowledged.

## Signal bot integration stability notes
- Bot selection is first-class for runtime and optimizer (`selectedBotId` + bot preset).
- Current models:
  - `oi-momentum-v1`
  - `signal-multi-factor-v1`
- Signal generation model changes do not change execution safety controls:
  - same runtime risk limits
  - same emergency-stop flow
  - same paper/demo execution lifecycle
- Multi-factor model currently uses Bybit-available factors in runtime/replay paths.
- CoinGlass remains optional for enrichment and must respect plan limits; runtime/optimizer startup does not require CoinGlass availability.

## Receive Data minute OI completeness
- Bybit remains primary and authoritative.
- Receive Data uses Bybit 1m klines as the base timeline.
- Bybit 5m historical OI points stay authoritative on their timestamps.
- Current production receive flow is Bybit-only.
- Minute rows are populated from last-known Bybit OI values between 5m boundary points.
- CoinGlass integration code is preserved for later activation but disabled (`COINGLASS_ENABLED=0`).
- Progress includes backend ETA for receive jobs.

## Recorder foundation (minute OI)
- Recorder foundation is added as a dedicated subsystem (`MinuteOiRecorder`) and is surfaced through `/api/process/status`.
- Recorder supports two operating modes:
  - `record_only`
  - `record_while_running`
- Boundary rule is enforced: recorder skips 5-minute boundary points and stores only intermediate minutes.
- Writes are append-only JSONL and keyed by timestamp, preparing for later timestamp-based field merges.
- Recorder storage is daily-chunked by symbol:
  - `backend/data/recorder/bybit/open_interest_1m/<SYMBOL>/<YYYY-MM-DD>.jsonl`
  - this keeps appends/copy operations practical for cross-machine manual transfer.
- Dataset merge behavior is timestamp-safe:
  - metric enrichment extends existing rows by timestamp
  - partial field updates do not replace whole rows, preserving previously merged fields.

Recommended soak procedure:
1) Start session and let it run for 24h.
2) Periodically check `/api/doctor` warnings and soak snapshot file growth.
3) Verify no emergency-stop message appears unless a risk threshold is intentionally tested.
