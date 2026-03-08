import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("botPresetStore default preset", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bots-dev-preset-test-"));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("creates and returns default preset when missing", async () => {
    const mod = await import("../presets/botPresetStore.js");
    const created = mod.ensureDefaultBotPreset("oi-momentum-v1");

    expect(created.id).toBe("default");
    expect(created.name).toBe("Default");

    const listed = mod.listBotPresets("oi-momentum-v1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe("default");
  });

  it("does not allow deleting default preset", async () => {
    const mod = await import("../presets/botPresetStore.js");
    mod.ensureDefaultBotPreset("oi-momentum-v1");

    expect(() => mod.deleteBotPreset("oi-momentum-v1", "default")).toThrow("default_bot_preset_cannot_be_deleted");
  });

  it("keeps presets isolated by bot id", async () => {
    const mod = await import("../presets/botPresetStore.js");
    mod.putBotPreset("oi-momentum-v1", "oi-fast", "OI Fast", {
      fundingCooldown: { beforeMin: 5, afterMin: 5 },
      signals: {
        priceThresholdPct: 0.5,
        oivThresholdPct: 0.5,
        requireFundingSign: true,
        dailyTriggerMin: 1,
        dailyTriggerMax: 10,
      },
      strategy: {
        klineTfMin: 5,
        entryOffsetPct: 0.1,
        entryTimeoutSec: 120,
        tpRoiPct: 2,
        slRoiPct: 2,
        rearmDelayMs: 120_000,
        applyFunding: true,
      },
    });
    mod.putBotPreset("signal-multi-factor-v1", "signal-hot", "Signal Hot", {
      fundingCooldown: { beforeMin: 5, afterMin: 5 },
      signals: {
        priceMovePct: 0.8,
        oiMovePct: 0.7,
        cvdMoveThreshold: 0.25,
        requireCvdDivergence: false,
        requireFundingExtreme: true,
        fundingMinAbsPct: 0.0002,
        minTriggersPerDay: 1,
        maxTriggersPerDay: 10,
        minBarsBetweenSignals: 1,
      },
      strategy: {
        signalTfMin: 5,
        lookbackCandles: 6,
        cooldownCandles: 2,
        entryOffsetPct: 0.1,
        entryTimeoutSec: 120,
        tpRoiPct: 2,
        slRoiPct: 2,
        rearmDelayMs: 120_000,
        applyFunding: true,
      },
    });

    const oiPresets = mod.listBotPresets("oi-momentum-v1");
    const signalPresets = mod.listBotPresets("signal-multi-factor-v1");

    expect(oiPresets.some((p) => p.id === "oi-fast")).toBe(true);
    expect(oiPresets.some((p) => p.id === "signal-hot")).toBe(false);
    expect(signalPresets.some((p) => p.id === "signal-hot")).toBe(true);
    expect(signalPresets.some((p) => p.id === "oi-fast")).toBe(false);
  });
});
