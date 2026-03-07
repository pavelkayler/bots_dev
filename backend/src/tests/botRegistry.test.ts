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
    expect(bot.defaults.signals.priceThresholdPct).toBeGreaterThan(0);
    expect(bot.defaults.signals.oivThresholdPct).toBeGreaterThan(0);
  });
});

