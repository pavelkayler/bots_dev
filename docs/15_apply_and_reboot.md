# 15 Apply (Config) + Session controls

Last update: 2026-02-26

This page describes operator-facing config application and session lifecycle controls.

## Config apply
- **Apply**
  - validates draft
  - applies config patch
  - does **not** auto-start/stop sessions

Notes:
- Numeric inputs may be temporarily empty while typing.
- Apply validates; if required fields are empty/invalid, Apply is blocked.
- `signals.requireFundingSign` is always forced true by backend normalization/back-compat (UI toggle removed).

## Session controls (runtime)
Session lifecycle controls are in the header (common across pages):
- **Start** (when STOPPED)
- **Stop** (when RUNNING)
- **Pause** (manual-only; intended for “close laptop / no internet”) 
- **Resume** (from PAUSED)

### Semantics
- `RUNNING` is the only state where upstream Bybit WS is connected.
- On `STOPPING/STOPPED/PAUSED`:
  - upstream WS is closed
  - timers are cancelled
  - live rows are cleared (`rows=[]`)

## Tape recording (automatic)
Optimizer tape recording is **automatic**:
- starts when session enters `RUNNING`
- stops when session leaves `RUNNING` (STOPPING/STOPPED/PAUSED)

There are no separate “Start and Record” or “Apply and Run” buttons.
