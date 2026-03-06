import { describe, expect, it } from "vitest";
import { OPTIMIZER_TF_ENABLED_VALUES, OPTIMIZER_TF_OPTIONS } from "./timeframes";

describe("optimizer timeframe options", () => {
  it("keep 5m and 10m disabled while 15m stays enabled", () => {
    const tf5 = OPTIMIZER_TF_OPTIONS.find((it) => it.value === 5);
    const tf10 = OPTIMIZER_TF_OPTIONS.find((it) => it.value === 10);
    expect(tf5?.disabled).toBe(true);
    expect(tf10?.disabled).toBe(true);
    expect(OPTIMIZER_TF_ENABLED_VALUES).toContain(15);
    expect(OPTIMIZER_TF_ENABLED_VALUES).not.toContain(5);
    expect(OPTIMIZER_TF_ENABLED_VALUES).not.toContain(10);
  });
});
