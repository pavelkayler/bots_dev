# 09 Project Structure

Last update: 2026-02-25

## Repository layout
- `backend/` Node.js (ESM) + TypeScript + Fastify + WS
- `frontend/` Vite + React + TypeScript + react-bootstrap + react-router-dom
- `docs/` canonical specs and contracts
- `start.bat` start backend + frontend locally

## Frontend architecture
- `src/app` providers and routing
- `src/pages` route pages (`/` dashboard, `/universe` builder)
- `src/features` feature modules (ws, session, market, events, config, universe, summary, stats, presets)
- `src/shared` shared types, utils, http, formatters

## Backend architecture (high level)
- `src/api` http routes, wsHub
- `src/bybit` WS client(s)
- `src/engine` market cache, candle refs, signal engine
- `src/paper` paper broker and summary builder
- `src/runtime` runtime session orchestrator + config store
- `data/`
  - `sessions/` per-run events + summary
  - `universes/` saved symbol sets
  - `presets/` saved config presets
