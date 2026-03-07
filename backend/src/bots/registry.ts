import { CONFIG } from "../config.js";

export const DEFAULT_BOT_ID = "oi-momentum-v1";
export const SIGNAL_BOT_ID = "signal-multi-factor-v1";

export type BotConfig = {
  fundingCooldown: {
    beforeMin: number;
    afterMin: number;
  };
  signals: {
    priceThresholdPct: number;
    oivThresholdPct: number;
    requireFundingSign: boolean;
    dailyTriggerMin: number;
    dailyTriggerMax: number;
  };
  strategy: {
    klineTfMin: number;
    entryOffsetPct: number;
    entryTimeoutSec: number;
    tpRoiPct: number;
    slRoiPct: number;
    rearmDelayMs: number;
    applyFunding: boolean;
  };
};

export type BotRegistryEntry = {
  id: string;
  name: string;
  defaults: BotConfig;
  normalizeBotConfig: (raw: unknown) => BotConfig;
  validateBotConfig: (cfg: BotConfig) => void;
};

function toFinite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Math.floor(toFinite(value, fallback));
  return Math.min(max, Math.max(min, n));
}

function normalizeCurrentBotConfig(raw: unknown): BotConfig {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const funding = source.fundingCooldown ?? {};
  const signals = source.signals ?? {};
  const strategy = source.strategy ?? {};
  return {
    fundingCooldown: {
      beforeMin: toFinite(funding.beforeMin, CONFIG.fundingCooldown.beforeMin),
      afterMin: toFinite(funding.afterMin, CONFIG.fundingCooldown.afterMin),
    },
    signals: {
      priceThresholdPct: Math.max(0, toFinite(signals.priceThresholdPct, CONFIG.signals.priceThresholdPct)),
      oivThresholdPct: Math.max(0, toFinite(signals.oivThresholdPct, CONFIG.signals.oivThresholdPct)),
      requireFundingSign: Boolean(signals.requireFundingSign ?? true),
      dailyTriggerMin: toInt(signals.dailyTriggerMin, CONFIG.signals.dailyTriggerMin, 1),
      dailyTriggerMax: toInt(signals.dailyTriggerMax, CONFIG.signals.dailyTriggerMax, 1),
    },
    strategy: {
      klineTfMin: toInt(strategy.klineTfMin, CONFIG.klineTfMin, 1, 60),
      entryOffsetPct: Math.max(0, toFinite(strategy.entryOffsetPct, CONFIG.paper.entryOffsetPct)),
      entryTimeoutSec: toInt(strategy.entryTimeoutSec, CONFIG.paper.entryTimeoutSec, 1),
      tpRoiPct: Math.max(0, toFinite(strategy.tpRoiPct, CONFIG.paper.tpRoiPct)),
      slRoiPct: Math.max(0, toFinite(strategy.slRoiPct, CONFIG.paper.slRoiPct)),
      rearmDelayMs: toInt(strategy.rearmDelayMs, CONFIG.paper.rearmDelayMs, 0),
      applyFunding: Boolean(strategy.applyFunding ?? CONFIG.paper.applyFunding),
    },
  };
}

function validateCurrentBotConfig(cfg: BotConfig): void {
  if (!Number.isInteger(cfg.signals.dailyTriggerMin) || cfg.signals.dailyTriggerMin < 1) {
    throw new Error("invalid_bot_dailyTriggerMin");
  }
  if (!Number.isInteger(cfg.signals.dailyTriggerMax) || cfg.signals.dailyTriggerMax < cfg.signals.dailyTriggerMin) {
    throw new Error("invalid_bot_dailyTriggerMax");
  }
}

const CURRENT_BOT: BotRegistryEntry = {
  id: DEFAULT_BOT_ID,
  name: "OI Momentum",
  defaults: normalizeCurrentBotConfig({
    fundingCooldown: CONFIG.fundingCooldown,
    signals: CONFIG.signals,
    strategy: {
      klineTfMin: CONFIG.klineTfMin,
      entryOffsetPct: CONFIG.paper.entryOffsetPct,
      entryTimeoutSec: CONFIG.paper.entryTimeoutSec,
      tpRoiPct: CONFIG.paper.tpRoiPct,
      slRoiPct: CONFIG.paper.slRoiPct,
      rearmDelayMs: CONFIG.paper.rearmDelayMs,
      applyFunding: CONFIG.paper.applyFunding,
    },
  }),
  normalizeBotConfig: normalizeCurrentBotConfig,
  validateBotConfig: validateCurrentBotConfig,
};

const SIGNAL_BOT: BotRegistryEntry = {
  id: SIGNAL_BOT_ID,
  name: "Signal Multi-Factor",
  defaults: normalizeCurrentBotConfig({
    fundingCooldown: CONFIG.fundingCooldown,
    signals: {
      priceThresholdPct: Math.max(0.1, CONFIG.signals.priceThresholdPct),
      oivThresholdPct: Math.max(0.1, CONFIG.signals.oivThresholdPct),
      requireFundingSign: true,
      dailyTriggerMin: CONFIG.signals.dailyTriggerMin,
      dailyTriggerMax: CONFIG.signals.dailyTriggerMax,
    },
    strategy: {
      klineTfMin: CONFIG.klineTfMin,
      entryOffsetPct: CONFIG.paper.entryOffsetPct,
      entryTimeoutSec: CONFIG.paper.entryTimeoutSec,
      tpRoiPct: CONFIG.paper.tpRoiPct,
      slRoiPct: CONFIG.paper.slRoiPct,
      rearmDelayMs: CONFIG.paper.rearmDelayMs,
      applyFunding: CONFIG.paper.applyFunding,
    },
  }),
  normalizeBotConfig: normalizeCurrentBotConfig,
  validateBotConfig: validateCurrentBotConfig,
};

const registry = new Map<string, BotRegistryEntry>([
  [CURRENT_BOT.id, CURRENT_BOT],
  [SIGNAL_BOT.id, SIGNAL_BOT],
]);

export function listBots(): Array<Pick<BotRegistryEntry, "id" | "name">> {
  return Array.from(registry.values()).map((b) => ({ id: b.id, name: b.name }));
}

export function getBotDefinition(botId: string): BotRegistryEntry {
  const id = String(botId || DEFAULT_BOT_ID);
  return registry.get(id) ?? CURRENT_BOT;
}
