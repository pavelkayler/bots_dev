# 09 Project Structure

Last update: 2026-02-25

## Repository layout
- `backend/` Node.js (ESM) + TypeScript + Fastify + WS
- `frontend/` Vite + React + TypeScript + react-bootstrap + react-router-dom
- `docs/` canonical specs and contracts
- `start.bat` start backend + frontend locally

## Frontend architecture
- `src/app` providers and routing
- `src/pages` route pages (`/` dashboard, `/universe` builder, `/optimizer` optimizer)
- `src/features` feature modules (ws, session, market, events, config, universe, summary, stats, presets, optimizer)
- `src/shared` shared types, utils, http, formatters

### WS client (frontend)
- The frontend WS connection to backend is implemented as a module-scope singleton.
- Route navigation should not create/destroy the socket; pages subscribe/unsubscribe to updates.

## Backend architecture (high level)
- `src/api` http routes, wsHub
- `src/bybit` WS client(s)
- `src/engine` market cache, candle refs, signal engine
- `src/paper` paper broker and summary builder
- `src/runtime` runtime session orchestrator + config store
- `src/optimizer`
  - tape store + recorder
  - runner (replay + random search)
  - optimizer settings (tapesDir)

## Data folders
- `backend/data/`
  - `sessions/` per-run events + summary
  - `universes/` saved symbol sets
  - `presets/` saved config presets
  - `tapes/` default tape directory (when optimizer `tapesDir` is not changed)
  - `optimizer_settings.json` persisted optimizer settings (tapesDir)
