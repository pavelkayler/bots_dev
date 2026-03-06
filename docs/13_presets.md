# 13 Presets and Profiles

Last update: 2026-03-06

## Purpose
Preset storage is split for future multi-bot support:
- bot presets (strategy-specific)
- execution profiles (shared execution/session/risk)

TP/SL is strategy semantics and is part of bot presets.

## Bot Presets
- Scope: one `botId`
- Storage: `backend/data/bot_presets/<botId>__<presetId>.json`
- Contains only bot config:
  - funding cooldown
  - signal thresholds / daily gates
  - strategy fields (`klineTfMin`, `entryOffsetPct`, `entryTimeoutSec`, `tpRoiPct`, `slRoiPct`, `rearmDelayMs`, `applyFunding`)

API:
- `GET /api/bot-presets?botId=<id>`
- `GET /api/bot-presets/:id?botId=<id>`
- `PUT /api/bot-presets/:id?botId=<id>`
- `DELETE /api/bot-presets/:id?botId=<id>`

## Execution Profiles
- Scope: shared across bots
- Storage: `backend/data/execution_profiles/<profileId>.json`
- Contains only generic execution/session/risk:
  - execution mode (`paper/demo/empty`)
  - direction gate / margin / leverage / fee / maxDailyLoss
  - risk limits (`maxTradesPerDay`, `maxLossPerDayUsdt`, `maxLossPerSessionUsdt`, `maxConsecutiveErrors`)

API:
- `GET /api/execution-profiles`
- `GET /api/execution-profiles/:id`
- `PUT /api/execution-profiles/:id`
- `DELETE /api/execution-profiles/:id`

## Selections
Current active selections are stored in runtime config:
- `selectedBotId`
- `selectedBotPresetId`
- `selectedExecutionProfileId`

API:
- `GET /api/config/selections`
- `POST /api/config/selections`

## Backward Compatibility
- Legacy presets in `backend/data/presets/*.json` remain readable.
- Legacy runtime config shape is migrated into split config on load.
- Runtime still exposes resolved compatibility fields for existing flow.
