# Frontend (Vite + React + TypeScript)

Last update: 2026-02-24

## Run
From `frontend/`:
```bash
npm install
npm run dev
```

Backend default:
- REST `http://localhost:8080`
- WS `ws://localhost:8080/ws`

## Pages
- `/` Dashboard
- `/universe` Universe builder

## LiveRows
The table updates from WS `tick` (1Hz). It should never require manual refresh to show active symbols.
