# 05 State Machines

## 1. Session state machine
States:
- STOPPED
- RUNNING
- COOLDOWN
- STOPPING

Transitions:
- STOPPED -> RUNNING (start)
- RUNNING -> COOLDOWN (enter funding window)
- COOLDOWN -> RUNNING (exit funding window)
- RUNNING/COOLDOWN -> STOPPING (stop requested)
- STOPPING -> STOPPED (all orders canceled and positions closed; WS->UI frozen)

Notes:
- During COOLDOWN: do not evaluate signals at all.

## 2. Per-symbol state machine
States:
- IDLE      : not armed / waiting for reference snapshots
- ARMED     : have prevCandleClose + prevCandleOivClose from last confirm
- ORDER_PLACED
- POSITION_OPEN

Transitions:
- IDLE -> ARMED: after first candle confirm is observed and ticker state exists
- ARMED -> ORDER_PLACED: signal fires, entry order placed
- ORDER_PLACED -> POSITION_OPEN: entry order touch-filled
- ORDER_PLACED -> ARMED: entry order expired/canceled, then re-arm after 1 second
- POSITION_OPEN -> ARMED: position closed (TP/SL/STOP), then re-arm after 1 second

Constraints:
- only one entry order at a time
- ignore any new signals while ORDER_PLACED or POSITION_OPEN
