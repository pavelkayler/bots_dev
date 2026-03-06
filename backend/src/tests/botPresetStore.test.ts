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
});

