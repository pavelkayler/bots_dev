# API transport architecture

## REST endpoints
- `POST /api/session/start`
- `POST /api/session/stop`
- `GET /api/session/status`
- `GET /api/health`
- `GET /api/version`

Request validation and response DTOs are defined in `api/dto.ts` and consumed by `api/http.ts`.

## WebSocket channel (`/ws`)
Connection flow:
1. Server sends `hello` once.
2. Server sends full `snapshot` once.
3. During RUNNING/COOLDOWN session:
   - `tick` at 1Hz (<= 1/sec)
   - `events_append` on event batches
   - `session_state` on lifecycle transitions
   - `error` on transport/engine diagnostics

## Message frequency and cadence
- `tick`: 1Hz, produced only by `SessionManager` scheduler.
- `events_append`: bursty, tied to engine/broker events.
- `session_state`: on transitions only.
- `hello`/`snapshot`: per WS connection.

## Data flow
```text
SessionManager listeners
   ├─ onTick ---------> wsHub.broadcast("tick")
   ├─ onEventsAppend -> wsHub.broadcast("events_append")
   ├─ onSessionState -> wsHub.broadcast("session_state")
   └─ onError -------> wsHub.broadcast("error")
```
