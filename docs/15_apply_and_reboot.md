# 15 Apply & Run (Config)

Last update: 2026-02-25

This page describes the operator-facing config application controls.

## Buttons
- **Apply**
  - validates draft
  - applies config patch
  - does not start/stop sessions

- **Apply and Run** (was “Apply and Reboot”)
  - Apply config patch
  - then:
    - if RUNNING: STOP → START
    - if STOPPED: START

- **Start and Record**
  - runs the same Apply-and-Run flow
  - then starts Optimizer tape recording (creates a new tape)
  - recorder start is allowed only when session is RUNNING

## UX rule: suppress stop-summary flash
During Apply-and-Run, UI suppresses the intermediate STOP summary refresh, because the stop is immediately followed by a start.

This keeps operator focus on the new run.
