import { describe, expect, test } from "vitest";
import { configStore } from "../runtime/configStore.js";

describe("config normalization", () => {
  test("forces signals.requireFundingSign=true", () => {
    const next = configStore.update({ signals: { requireFundingSign: false } });
    expect(next.signals.requireFundingSign).toBe(true);
  });

  test("ignores removed legacy optimizer keys without crashing", () => {
    const legacy = {
      ["\u0074apesDir"]: "/tmp/legacy",
      ["\u0074apeIds"]: ["a"],
      ["\u0074apeId"]: "x",
      optimizer: { ["\u0074apesDir"]: "/tmp/legacy" },
      paper: { enabled: true },
    } as Record<string, unknown>;

    const next = configStore.update(legacy);
    expect(next.paper.enabled).toBe(true);
    expect(next.signals.requireFundingSign).toBe(true);
  });

  test("keeps stable defaults for directionMode", () => {
    const next = configStore.get();
    expect(["both", "long", "short"]).toContain(next.paper.directionMode);
  });

  test("keeps TP/SL inside botConfig strategy after migration", () => {
    const next = configStore.get();
    expect(next.selectedBotId).toBeTruthy();
    expect(next.botConfig?.strategy.tpRoiPct).toBeTypeOf("number");
    expect(next.botConfig?.strategy.slRoiPct).toBeTypeOf("number");
    expect(next.executionProfile?.paper).toBeTruthy();
    expect((next.executionProfile?.paper as any).tpRoiPct).toBeUndefined();
    expect((next.executionProfile?.paper as any).slRoiPct).toBeUndefined();
  });

  test("normalizes runtime numeric values to safe bounds", () => {
    const next = configStore.update({ paper: { entryTimeoutSec: -5, maxDailyLossUSDT: -1 } as any });
    expect(next.paper.entryTimeoutSec).toBeGreaterThanOrEqual(1);
    expect(next.paper.maxDailyLossUSDT).toBeGreaterThanOrEqual(0);
    expect(() => configStore.update({ riskLimits: { maxTradesPerDay: 0 } as any })).toThrow();
  });

  test("resolves unknown selectedBotId to registry default", () => {
    const next = configStore.setSelections({ selectedBotId: "unknown-bot-id" });
    expect(next.selectedBotId).toBe("oi-momentum-v1");
    expect(next.selectedBotPresetId).toBeTruthy();
  });
});
