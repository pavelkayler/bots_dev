# 18 Stability & long-run operations

Last update: 2026-02-26

This document describes stability mechanisms intended for multi-hour / multi-day runs.

## Low disk guard
- Threshold: **2GB** free in the backend data directory.
- Exposed via `/api/doctor` as `dataDirBytesFree` with `low_disk` warning.
- Behavior:
  - Tape recorder performs periodic checks; if low disk is detected it stops recording gracefully and logs the stop reason.
  - Optimizer checkpoint writes are skipped on low disk (job message is appended).

## Tape recording backpressure
Tape recorder is drain-aware:
- If stream `write()` returns false, recorder waits for `drain`.
- Recorder maintains a bounded queue; if exceeded it stops recording with a `recording_backpressure` reason.

## Tape rotation
- Hard cap: **90 MB** per tape segment.
- Rotation is transparent: recording stays ON, tapeId is updated to `-segN`.

## Optimizer isolation
- Optimizer heavy compute runs in a worker thread.
- Main server remains responsive to UI polling and session runtime.

## Soak snapshots
- While runtime session is RUNNING, backend appends a JSON line every 60 seconds:
  - `backend/data/soak_snapshots.jsonl`
- `/api/soak/last` returns the last snapshot cached in memory.

Recommended soak procedure:
1) Start session and let it run 24h.
2) Periodically check:
   - `/api/doctor` warnings
   - tape rotation output
   - soak snapshot file growth
