# 13 Presets (Config presets)

Last update: 2026-02-25

## Purpose
Presets are named snapshots of runtime config (excluding Universe selection itself), to allow fast repeatable runs.

## Storage
- `backend/data/presets/*.json`

## UI behavior
- Preset selector shows label: `<name> [tf=<klineTfMin>m]`
- Buttons:
  - **Save**: overwrites the currently selected preset with the current draft config
  - **Remove**: deletes the selected preset
- Selecting a preset loads its config into the **draft** (does not auto-apply).
- Preferred Universe auto-select (best-effort):
  - If preset name contains `[<token>]` (e.g. `[10m/6%]`)
  - UI tries to find a saved Universe with `universe.name === token` and selects it.

## API
- `GET /api/presets`
- `GET /api/presets/:id`
- `PUT /api/presets/:id`
- `DELETE /api/presets/:id`

## Defaults
Seeded presets (examples):
- Conservative [20m/8%]
- Balanced [10m/6%]
- Aggressive [5m/5%]

All presets default to:
- `paper.directionMode: "both"`
