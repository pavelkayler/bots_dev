import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("recorderUniverseStore", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bots-dev-recorder-universe-"));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("persists explicit recorder symbols", async () => {
    const mod = await import("../recorder/recorderUniverseStore.js");
    const saved = mod.setRecorderUniverseSymbols(["ethusdt", "BTCUSDT", "ethusdt"]);

    expect(saved.selectedId).toBeNull();
    expect(saved.symbols).toEqual(["ETHUSDT", "BTCUSDT"]);

    const loaded = mod.readRecorderUniverseState();
    expect(loaded.symbols).toEqual(["ETHUSDT", "BTCUSDT"]);
  });

  it("resolves symbols by selected universe id", async () => {
    const universeMod = await import("../universe/universeStore.js");
    universeMod.writeUniverse({
      meta: {
        id: "u-test",
        name: "U Test",
        minTurnoverUsd: 1,
        minVolatilityPct: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        count: 2,
      },
      symbols: ["SOLUSDT", "DOGEUSDT"],
    });

    const mod = await import("../recorder/recorderUniverseStore.js");
    const selected = mod.setRecorderUniverseById("u-test");
    expect(selected?.selectedId).toBe("u-test");
    expect(selected?.symbols).toEqual(["SOLUSDT", "DOGEUSDT"]);
    expect(mod.resolveRecorderSymbols()).toEqual(["SOLUSDT", "DOGEUSDT"]);
  });
});
