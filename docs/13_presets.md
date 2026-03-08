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
- Contains only bot config (bot-specific schema):
  - `oi-momentum-v1`:
    - funding cooldown
    - `signals.priceThresholdPct`, `signals.oivThresholdPct`, trigger bounds
    - `strategy.klineTfMin`, TP/SL, offset, timeout, rearm, applyFunding
  - `signal-multi-factor-v1`:
    - signal window (`signalTfMin`, `lookbackCandles`, `cooldownCandles`)
    - overheating thresholds (`priceMovePct`, `oiMovePct`, `cvdMoveThreshold`, divergence flag)
    - funding/context (`requireFundingExtreme`, `fundingMinAbsPct`)
    - trigger controls (`minTriggersPerDay`, `maxTriggersPerDay`, `minBarsBetweenSignals`)
    - execution-close semantics in bot config (TP/SL, offset, timeout, rearm, applyFunding)

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

Preset selection is strictly bot-bound:
- dashboard shows only presets for currently selected bot
- OI pages show only OI presets
- Signal pages and Signal optimizer show only Signal presets

## Backward Compatibility
- Legacy presets in `backend/data/presets/*.json` remain readable.
- Legacy runtime config shape is migrated into split config on load.
- Runtime still exposes resolved compatibility fields for existing flow.
