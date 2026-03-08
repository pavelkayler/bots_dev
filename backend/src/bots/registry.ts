import { CONFIG } from "../config.js";

export const DEFAULT_BOT_ID = "oi-momentum-v1";
export const SIGNAL_BOT_ID = "signal-multi-factor-v1";

export type OiMomentumBotConfig = {
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

export type SignalBotConfig = {
  fundingCooldown: {
    beforeMin: number;
    afterMin: number;
  };
  signals: {
    priceMovePct: number;
    oiMovePct: number;
    cvdMoveThreshold: number;
    requireCvdDivergence: boolean;
    requireFundingExtreme: boolean;
    fundingMinAbsPct: number;
    minTriggersPerDay: number;
    maxTriggersPerDay: number;
    minBarsBetweenSignals: number;
  };
  strategy: {
    signalTfMin: number;
    lookbackCandles: number;
    cooldownCandles: number;
    entryOffsetPct: number;
    entryTimeoutSec: number;
    tpRoiPct: number;
    slRoiPct: number;
    rearmDelayMs: number;
    applyFunding: boolean;
  };
};

export type BotConfig = OiMomentumBotConfig | SignalBotConfig;

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

function normalizeCurrentBotConfig(raw: unknown): OiMomentumBotConfig {
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
  const oiCfg = cfg as OiMomentumBotConfig;
  if (!Number.isInteger(oiCfg.signals.dailyTriggerMin) || oiCfg.signals.dailyTriggerMin < 1) {
    throw new Error("invalid_bot_dailyTriggerMin");
  }
  if (!Number.isInteger(oiCfg.signals.dailyTriggerMax) || oiCfg.signals.dailyTriggerMax < oiCfg.signals.dailyTriggerMin) {
    throw new Error("invalid_bot_dailyTriggerMax");
  }
}

function normalizeSignalBotConfig(raw: unknown): SignalBotConfig {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const funding = source.fundingCooldown ?? {};
  const signals = source.signals ?? {};
  const strategy = source.strategy ?? {};

  const legacyPriceThresholdPct = toFinite(signals.priceThresholdPct, CONFIG.signals.priceThresholdPct);
  const legacyOivThresholdPct = toFinite(signals.oivThresholdPct, CONFIG.signals.oivThresholdPct);
  const legacyDailyTriggerMin = toInt(signals.dailyTriggerMin, CONFIG.signals.dailyTriggerMin, 1);
  const legacyDailyTriggerMax = toInt(signals.dailyTriggerMax, CONFIG.signals.dailyTriggerMax, 1);

  return {
    fundingCooldown: {
      beforeMin: toInt(funding.beforeMin, CONFIG.fundingCooldown.beforeMin, 0, 240),
      afterMin: toInt(funding.afterMin, CONFIG.fundingCooldown.afterMin, 0, 240),
    },
    signals: {
      priceMovePct: Math.max(0, toFinite(signals.priceMovePct, Math.max(0.1, legacyPriceThresholdPct))),
      oiMovePct: Math.max(0, toFinite(signals.oiMovePct, Math.max(0.1, legacyOivThresholdPct))),
      cvdMoveThreshold: Math.max(0, toFinite(signals.cvdMoveThreshold, 0.1)),
      requireCvdDivergence: Boolean(signals.requireCvdDivergence ?? false),
      requireFundingExtreme: Boolean(signals.requireFundingExtreme ?? (signals.requireFundingSign ?? true)),
      fundingMinAbsPct: Math.max(0, toFinite(signals.fundingMinAbsPct, 0.0001)),
      minTriggersPerDay: toInt(signals.minTriggersPerDay, Math.max(1, legacyDailyTriggerMin), 1),
      maxTriggersPerDay: toInt(signals.maxTriggersPerDay, Math.max(1, legacyDailyTriggerMax), 1),
      minBarsBetweenSignals: toInt(signals.minBarsBetweenSignals, 1, 0),
    },
    strategy: {
      signalTfMin: toInt(strategy.signalTfMin ?? strategy.klineTfMin, CONFIG.klineTfMin, 1, 60),
      lookbackCandles: toInt(strategy.lookbackCandles, 3, 1),
      cooldownCandles: toInt(strategy.cooldownCandles, 1, 0),
      entryOffsetPct: Math.max(0, toFinite(strategy.entryOffsetPct, CONFIG.paper.entryOffsetPct)),
      entryTimeoutSec: toInt(strategy.entryTimeoutSec, CONFIG.paper.entryTimeoutSec, 1),
      tpRoiPct: Math.max(0, toFinite(strategy.tpRoiPct, CONFIG.paper.tpRoiPct)),
      slRoiPct: Math.max(0, toFinite(strategy.slRoiPct, CONFIG.paper.slRoiPct)),
      rearmDelayMs: toInt(strategy.rearmDelayMs, CONFIG.paper.rearmDelayMs, 0),
      applyFunding: Boolean(strategy.applyFunding ?? true),
    },
  };
}

function validateSignalBotConfig(cfg: BotConfig): void {
  const signalCfg = cfg as SignalBotConfig;
  if (!Number.isInteger(signalCfg.signals.minTriggersPerDay) || signalCfg.signals.minTriggersPerDay < 1) {
    throw new Error("invalid_signal_bot_dailyTriggerMin");
  }
  if (!Number.isInteger(signalCfg.signals.maxTriggersPerDay) || signalCfg.signals.maxTriggersPerDay < signalCfg.signals.minTriggersPerDay) {
    throw new Error("invalid_signal_bot_dailyTriggerMax");
  }
  if (signalCfg.fundingCooldown.beforeMin < 0 || signalCfg.fundingCooldown.afterMin < 0) {
    throw new Error("invalid_signal_bot_funding_cooldown");
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
  defaults: normalizeSignalBotConfig({
    fundingCooldown: CONFIG.fundingCooldown,
    signals: {
      priceMovePct: Math.max(0.1, CONFIG.signals.priceThresholdPct),
      oiMovePct: Math.max(0.1, CONFIG.signals.oivThresholdPct),
      cvdMoveThreshold: 0.1,
      requireCvdDivergence: false,
      requireFundingExtreme: true,
      fundingMinAbsPct: 0.0001,
      minTriggersPerDay: CONFIG.signals.dailyTriggerMin,
      maxTriggersPerDay: CONFIG.signals.dailyTriggerMax,
      minBarsBetweenSignals: 1,
    },
    strategy: {
      signalTfMin: CONFIG.klineTfMin,
      lookbackCandles: 3,
      cooldownCandles: 1,
      entryOffsetPct: CONFIG.paper.entryOffsetPct,
      entryTimeoutSec: CONFIG.paper.entryTimeoutSec,
      tpRoiPct: CONFIG.paper.tpRoiPct,
      slRoiPct: CONFIG.paper.slRoiPct,
      rearmDelayMs: CONFIG.paper.rearmDelayMs,
      applyFunding: CONFIG.paper.applyFunding,
    },
  }),
  normalizeBotConfig: normalizeSignalBotConfig,
  validateBotConfig: validateSignalBotConfig,
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
