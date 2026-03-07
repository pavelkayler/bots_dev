import { describe, expect, it } from "vitest";
import { fmtEta, pct } from "./ProcessIndicatorsBar";

describe("ProcessIndicatorsBar formatters", () => {
  it("formats eta consistently", () => {
    expect(fmtEta(null)).toBe("-");
    expect(fmtEta(0)).toBe("-");
    expect(fmtEta(61)).toBe("1m 01s");
  });

  it("formats percentage with bounds", () => {
    expect(pct(null)).toBe("-");
    expect(pct(33.333)).toBe("33%");
    expect(pct(33.8)).toBe("34%");
    expect(pct(-5)).toBe("0%");
    expect(pct(123)).toBe("100%");
  });
});
