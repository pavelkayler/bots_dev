# 14 Direction mode (paper.directionMode)

Last update: 2026-02-25

## Field
`paper.directionMode`: `"both" | "long" | "short"`

Default: `"both"`

## Semantics
Direction mode gates the strategy at two levels:
1) **Signal generation / display**
   - blocked-direction signals are suppressed (LiveRows shows no signal + no reason)
2) **Execution safety**
   - even if a blocked-direction signal somehow reaches execution, orders/positions are not opened

## Backward compatibility
Older configs that contained `paper.longOnly` are normalized:
- `longOnly: true` → `directionMode: "long"`
- otherwise → `directionMode: "both"`
