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
- `/events` - appended events stream with filters

## Runtime UX/performance updates

- Symbols page supports a **Pause rendering** toggle:
  - websocket messages continue to be consumed,
  - visible symbol table updates are paused until resume.
- Navbar shows websocket connection state (`CONNECTED` / `RECONNECTING` / `DISCONNECTED`) and **last tick timestamp**.
- Symbol state is maintained in `Map` structures to reduce per-tick churn when updating only symbol deltas.

## Symbols page operator controls (Task #10)

- **Text filter** (substring match) for symbol names.
- **Status dropdown**: `ALL`, `IDLE`, `ARMED`, `ORDER_PLACED`, `POSITION_OPEN`.
- **Only active** toggle: shows only `ORDER_PLACED` or `POSITION_OPEN`.
- **Sorting selector**:
  - `priceMovePct` descending,
  - `oivMovePct` descending,
  - funding countdown ascending.
- Sticky table header + scrollable table container for 100–200 symbols.
- Number readability:
  - `markPrice`: heuristic precision (2/4/6 decimals by magnitude),
  - percent fields at 2 decimals,
  - OIV rendered compact (`12.3M`) with full numeric value on hover.

## Badge semantics

- Status badges:
  - `IDLE` (gray),
  - `ARMED` (blue),
  - `ORDER_PLACED` (orange),
  - `POSITION_OPEN` (green).
- Gate badges:
  - `COOLDOWN`: global funding cooldown currently blocks entries,
  - `STALE`: market/funding data is stale or incomplete.
- Row tooltip includes derived **"why not trading"** reason using existing status/gates.

## Events page operator controls

- Severity-colored event type badges by class (signal/order/position/funding/error).
- Quick filter chips for `signal_fired`, `order_filled`, `position_closed`, `funding_applied`, `error`.
- Expand/collapse for JSON payload per event row (collapsed by default).
