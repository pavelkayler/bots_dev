# 15 Apply & Reboot (Config)

Last update: 2026-02-25

## Buttons
- **Apply**
  - validates draft
  - applies config patch
  - does not start/stop sessions
- **Apply and Reboot**
  - Apply config patch
  - then:
    - if RUNNING: STOP → START
    - if STOPPED: START

## UX rule: suppress stop-summary flash
During Apply & Reboot, UI suppresses the intermediate STOP summary refresh, because the stop is immediately followed by a start.

This keeps operator focus on the new run.
