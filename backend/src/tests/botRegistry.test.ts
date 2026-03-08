import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_ID, SIGNAL_BOT_ID, getBotDefinition, listBots } from "../bots/registry.js";

describe("bot registry", () => {
  it("exposes both default and signal multi-factor bots", () => {
    const bots = listBots();
    const ids = bots.map((b) => b.id);
    expect(ids).toContain(DEFAULT_BOT_ID);
    expect(ids).toContain(SIGNAL_BOT_ID);
  });

  it("resolves signal bot definition with defaults", () => {
    const bot = getBotDefinition(SIGNAL_BOT_ID);
    expect(bot.id).toBe(SIGNAL_BOT_ID);
    const cfg = bot.defaults as any;
    expect(cfg.signals.priceMovePct).toBeGreaterThan(0);
    expect(cfg.signals.oiMovePct).toBeGreaterThan(0);
    expect(cfg.signals.cvdMoveThreshold).toBeGreaterThanOrEqual(0);
  });

  it("keeps bot-specific normalizers isolated", () => {
    const oi = getBotDefinition(DEFAULT_BOT_ID);
    const signal = getBotDefinition(SIGNAL_BOT_ID);

    const oiCfg = oi.normalizeBotConfig({ fundingCooldown: { beforeMin: -10, afterMin: -10 } } as any);
    const signalCfg = signal.normalizeBotConfig({ fundingCooldown: { beforeMin: -10, afterMin: -10 } } as any);

    expect(Number.isFinite(oiCfg.fundingCooldown.beforeMin)).toBe(true);
    expect(signalCfg.fundingCooldown.beforeMin).toBeGreaterThanOrEqual(0);
    expect(signal.validateBotConfig).not.toBe(oi.validateBotConfig);
    expect(signal.normalizeBotConfig).not.toBe(oi.normalizeBotConfig);
  });
});
