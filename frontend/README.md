# Frontend (Vite + React + TypeScript)

## Run

```bash
npm install
npm run dev
```

Default dev URL: `http://localhost:5173`.

## Environment variables

Create `frontend/.env` (or `.env.local`) if needed:

- `VITE_API_BASE_URL` - Optional REST base URL (default: same origin).
  - Example: `http://localhost:3000`
- `VITE_WS_URL` - Optional full WebSocket URL (default: `{ws|wss}://<current-host>/ws`).
  - Example: `ws://localhost:3000/ws`

If backend is served from another host/port during development, set both values.

## Implemented pages

- `/config` - session start form for `SessionStartRequest`
- `/runtime` - state, counters, cooldown, stop control
- `/symbols` - full symbols table updated from WS `snapshot` + `tick`
- `/events` - appended events stream with symbol/type filters
