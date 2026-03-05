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
});
