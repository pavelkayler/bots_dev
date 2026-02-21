# RUN.md — local operator guide

## Prerequisites
- Node.js 20+ (recommended: 20 LTS)
- npm 10+

## Install dependencies
From repository root:

```bash
npm install --prefix backend
npm install --prefix frontend
```

## Start locally (single command)
### Cross-platform (macOS/Linux/Windows with Node)
```bash
npm run dev:start
```

This launches:
- backend on `http://localhost:3000`
- frontend on `http://localhost:5173`

### Windows batch helper
```bat
dev.bat start
```

## Stop and restart
### Cross-platform
```bash
npm run dev:stop
npm run dev:restart
```

### Windows batch helper
```bat
dev.bat stop
dev.bat restart
```

## Runtime diagnostics
- Health endpoint: `GET /api/health`
- Version endpoint: `GET /api/version`
- Session status endpoint: `GET /api/session/status`

## Graceful shutdown behavior
- Clicking STOP in UI or calling `POST /api/session/stop` cancels active orders and closes open positions.
- Pressing `Ctrl+C` in backend process triggers the same graceful session stop sequence, including eventlog flush.

## Session logs
Event logs are written per session to:

`data/sessions/<sessionId>/events.jsonl`
