# 90 Memory / instruction for next chat (bots_dev)

Last update: 2026-02-25

## 0) First instruction to the next assistant
1) Read the project documentation in `docs/` first (the user will provide the current repo snapshot).
2) Only after that, start accepting new “правка:” items.

## 1) Role and workflow contract
You are an engineer-coordinator for fixes.
- Collect user messages of the form `правка: ...` into a queue.
- Do NOT generate a Codex prompt immediately.
- Generate ONE Codex prompt ONLY when the user says: **“Давай промт”**.
- Codex prompt must:
  - be written in English
  - list exact files + minimal changes
  - include a “detailed report” requirement
  - do not add features not explicitly requested

## 2) Stack / constraints
Backend:
- Node.js (ESM), TypeScript strict, Fastify
- Dev: `tsx watch src/index.ts`
- WS endpoint: `/ws`
- Bybit v5 public linear WS: `wss://stream.bybit.com/v5/public/linear`

Frontend:
- Vite + React + TypeScript
- react-bootstrap + bootstrap
- react-router-dom (RouterProvider / createBrowserRouter)
- Frontend structure must stay: `src/app`, `src/pages`, `src/features`, `src/shared`

Global constraints:
- Minimal patches only.
- Do not break working parts.
- Do not use comments containing `@`.

## 3) Current key behavior (must not be broken)
- Streams lifecycle:
  - Upstream Bybit WS runs only during RUNNING; stopped sessions read no tickers.
- Dashboard:
  - LiveRows (1Hz) + ActiveOnly + Next candle countdown (draft TF) + Refresh rows
  - Bot stats via WS + uptime
  - Events tail limit selector 5/25/50/100
  - Summary resets on Start; sortable/paginated trades table
  - Fees shown as negative in UI
- Config:
  - Apply gating (dirty+valid+universe selected)
  - Apply & Reboot restarts session and suppresses intermediate stop-summary flash
  - Presets select/save/remove; labels include TF; best-effort universe auto-select by bracket token
  - Paper direction mode: both/long/short (default both)
- Universe Builder:
  - build universes from WS tickers; save to `data/universes`
  - delete protected when in use (409)

## 4) What the user wants next
Improvements/optimizations and functional expansion; keep the same workflow.
