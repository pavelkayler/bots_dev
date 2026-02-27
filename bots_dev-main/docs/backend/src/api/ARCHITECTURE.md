# API transport architecture

Last update: 2026-02-24

## REST
- `/api/session/*` start/stop/status + downloads
- `/api/config` get/patch
- `/api/universes/*` list/create/read

## WebSocket `/ws`
- push: `snapshot`, `tick`, `streams_state`, `events_tail`, `events_append`
- receive: `events_tail_request`, `rows_refresh_request`, `streams_toggle_request`, `streams_apply_subscriptions_request`

Design notes:
- WS is used for high-frequency UI updates and event streaming.
- REST is used for config/universe persistence and file downloads.
