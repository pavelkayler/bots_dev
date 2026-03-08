import { describe, expect, it } from "vitest";
import { makeOptimizerScopedStorageKey, resolveOptimizerStorageBotId } from "./storageScope";

describe("optimizer storage scope", () => {
  it("uses per-bot keys and keeps bots isolated", () => {
    const oi = makeOptimizerScopedStorageKey("oi-momentum-v1", "ranges");
    const signal = makeOptimizerScopedStorageKey("signal-multi-factor-v1", "ranges");
    expect(oi).not.toBe(signal);
    expect(oi).toContain(".oi-momentum-v1.");
    expect(signal).toContain(".signal-multi-factor-v1.");
  });

  it("falls back to default bot id for empty values", () => {
    expect(resolveOptimizerStorageBotId("")).toBe("oi-momentum-v1");
    expect(resolveOptimizerStorageBotId(undefined)).toBe("oi-momentum-v1");
  });
});

