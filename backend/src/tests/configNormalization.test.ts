import { describe, expect, test } from "vitest";
import { configStore } from "../runtime/configStore.js";

describe("config normalization", () => {
  test("forces signals.requireFundingSign=true", () => {
    const next = configStore.update({ signals: { requireFundingSign: false } });
    expect(next.signals.requireFundingSign).toBe(true);
  });

  test("ignores removed legacy tape keys without crashing", () => {
    const next = configStore.update({
      tapesDir: "/tmp/legacy",
      tapeIds: ["a"],
      tapeId: "x",
      optimizer: { tapesDir: "/tmp/legacy" },
      paper: { enabled: true },
    });
    expect(next.paper.enabled).toBe(true);
    expect(next.signals.requireFundingSign).toBe(true);
  });

  test("keeps stable defaults for directionMode", () => {
    const next = configStore.get();
    expect(["both", "long", "short"]).toContain(next.paper.directionMode);
  });
});
