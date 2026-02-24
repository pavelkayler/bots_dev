# Backend API (REST + WS)

Last update: 2026-02-24

## Run locally
From `backend/`:
```bash
npm install
npm run dev
```

## Key endpoints
- `GET /api/session/status`
- `POST /api/session/start`
- `POST /api/session/stop`
- `GET /api/config`
- `POST /api/config`
- `GET /api/session/events/download`
- `GET /api/session/summary`
- `GET /api/session/summary/download`
- `GET /api/universes`
- `POST /api/universes/create`

## WS
- `ws://localhost:8080/ws`
The dashboard connects here and receives:
- snapshot
- tick (1Hz)
- events tail + append
