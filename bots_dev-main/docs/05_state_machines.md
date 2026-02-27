# 05 State Machines

Last update: 2026-02-25

## 1) Session state
- `STOPPED` → `RUNNING` → `STOPPING` → `STOPPED`

Rules:
- Paper execution happens only when `RUNNING`.
- Universe changes are allowed only while session is `STOPPED` (UI blocks Apply if Universe is not selected; Universe changes typically require STOPPED).

## 2) Streams state (Bybit public WS upstream)
- `streamsEnabled: boolean`
  - **not an operator UI switch anymore**
  - driven by session lifecycle:
    - RUNNING → enabled (connect upstream)
    - STOPPING/STOPPED → disabled (disconnect + cancel reconnect timers)
- `bybitConnected: boolean` — upstream WS connection status

Notes:
- The Dashboard header shows streams state, but no longer provides manual toggle/apply buttons.

## 3) Paper state per symbol
- `IDLE`
- `ENTRY_PENDING`
- `OPEN`
- `CLOSED` (represented as events + summary; not kept as a row state)

## 4) Direction mode (paper)
- `paper.directionMode`: `"both" | "long" | "short"` (default `"both"`)
- Applied at two layers:
  - signal generation (suppresses blocked direction signals)
  - execution safety guard (prevents blocked direction orders)
