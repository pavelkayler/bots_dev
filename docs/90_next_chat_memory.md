# 90 Memory / instruction for next chat (bots_dev)

Last update: 2026-02-26

## 0) First instruction to the next assistant
1) Read project documentation in `docs/` first (user will provide current repo snapshot).
2) Only after that, accept new `правка:` items into a queue.

## 1) Workflow contract
- User writes: `правка: ...` → add to queue.
- Do NOT generate a Codex prompt immediately.
- Generate exactly ONE Codex prompt ONLY when user says: **“Давай промт”**.
- Codex prompt must:
  - be written in English
  - list exact files + minimal diffs
  - avoid extra features/refactors
  - include verification commands + a detailed reporting requirement
  - do not add any comments containing `@`

## 2) Stack / constraints
Backend:
- Node.js (ESM), TypeScript strict, Fastify
- Dev: `tsx watch src/index.ts`
- UI WS endpoint: `/ws`
- Bybit v5 public linear WS: `wss://stream.bybit.com/v5/public/linear`

Frontend:
- Vite + React + TypeScript
- react-bootstrap + bootstrap
- react-router-dom
- Structure must stay modular: `src/app`, `src/pages`, `src/features`, `src/shared`

## 3) Invariants (must not be broken)
- Streams lifecycle:
  - Upstream Bybit WS runs only during `RUNNING`.
  - In `STOPPING/STOPPED/PAUSED`: upstream closed, timers cancelled, `rows=[]`.
- Frontend WS to backend is singleton and must not reconnect on navigation.
- Funding sign gating:
  - `signals.requireFundingSign` must always be true (UI toggle removed; backend enforces).
  - fundingRate > 0 → LONG allowed; fundingRate < 0 → SHORT allowed.
- Build rule:
  - `npm run build` may fail due to pre-existing frontend TS debt; only fix when explicitly requested.

## 4) What exists now (high-level)
### Runtime session
- Session controls include Start/Stop and manual Pause/Resume.
- Pause is manual-only and intended for “close laptop / no internet for a while”.

### Tape recording
- Automatic on entering RUNNING; stops on leaving RUNNING.
- Full ticker payload only, per-symbol throttle 5s.
- Rotation: max **90 MB** per tape segment; creates `-seg2`, `-seg3`, ...

### Optimizer
- Heavy compute runs in **worker_threads** (main server stays responsive).
- Job features:
  - progress with 0.01 precision
  - elapsed + ETA
  - pause/resume/cancel
  - incremental preview results
  - disk checkpoints + retention
  - rememberNegatives blacklist (persistent per runKey) + effectiveSeed shifting by runIndex
- Loop features:
  - run N times or infinite until stop
  - loop elapsed
  - per-tape `runsTotal` counter shown in tape list
  - loop results table is cumulative (aggregates candidates across loop iterations)

### Health / stability
- `/api/doctor` returns best-effort disk/path checks and warnings (low disk threshold 2GB).
- Tape recorder backpressure guard + low disk stop reason.
- Soak snapshots: JSONL append every 60s while RUNNING; `/api/soak/last` exposes cached last snapshot.

## 5) Next focus
Continue stability/ops improvements:
- tighten guards (disk/backpressure/memory)
- verify long-run soak behavior (24h/72h)
- keep UI responsive under optimizer load

## Next planned work batch (tape removal + remote historical cache)

Planned direction:
- Remove tape recording subsystem completely.
- Introduce Dataset Target (Universe + Range) and a server-side historical cache built from Bybit REST history endpoints.
- Add UI: Universe selector, Range presets/manual datetime, Receive Data (applies selected target) with rate-limit-aware progress.
- Standardize table pagination UI across the app.
- Universe page: remove unused buttons, fix Create 400, add progress, preserve Create state across routing.
- Optimizer: remove single-run controls and manual from/to; use Dataset Target range.
