# 05 State Machines

Last update: 2026-02-24

## 1) Session state
- `STOPPED` → `RUNNING` → `STOPPING` → `STOPPED`

Rules:
- Paper execution happens only when `RUNNING`.
- Universe changes are allowed only while session is `STOPPED` (to avoid mid-stream resubscribe drift).

## 2) Streams state (WS data)
- `streamsEnabled: boolean` — operator switch
- `bybitConnected: boolean` — upstream WS connection status

## 3) Paper state per symbol
- `IDLE`
- `ENTRY_PENDING`
- `OPEN`
- `CLOSED` (not kept as a row state; it becomes an event + summary)
