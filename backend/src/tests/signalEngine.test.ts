import { describe, expect, it } from "vitest";
import { SignalEngine } from "../engine/SignalEngine.js";

describe("SignalEngine", () => {
  it("returns no_refs when references are absent", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: false, directionMode: "both" });
    const decision = engine.decide({ priceMovePct: null, oivMovePct: 1, fundingRate: 1, cooldownActive: false });
    expect(decision.reason).toBe("no_refs");
  });

  it("returns ok when both thresholds pass", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: false, directionMode: "both" });
    const decision = engine.decide({ priceMovePct: 1.2, oivMovePct: 1.1, fundingRate: 0, cooldownActive: false });
    expect(decision.reason).toBe("ok_long");
    expect(decision.signal).toBe("LONG");
  });

  it("enforces funding-sign policy by direction", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: true, directionMode: "both" });
    expect(engine.decide({ priceMovePct: 2, oivMovePct: 2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("ok_long");
    expect(engine.decide({ priceMovePct: -2, oivMovePct: -2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("funding_mismatch");
    expect(engine.decide({ priceMovePct: -2, oivMovePct: -2, fundingRate: -0.01, cooldownActive: false }).reason).toBe("ok_short");
    expect(engine.decide({ priceMovePct: 2, oivMovePct: 2, fundingRate: -0.01, cooldownActive: false }).reason).toBe("funding_mismatch");
  });

  it("blocks on cooldown", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: false, directionMode: "both" });
    const decision = engine.decide({ priceMovePct: 2, oivMovePct: 2, fundingRate: 1, cooldownActive: true });
    expect(decision.reason).toBe("cooldown");
    expect(decision.signal).toBeNull();
  });

  it("supports multi-factor model scoring path", () => {
    const engine = new SignalEngine({
      priceThresholdPct: 1,
      oivThresholdPct: 1,
      requireFundingSign: true,
      directionMode: "both",
      model: "signal-multi-factor-v1",
    });
    expect(engine.decide({ priceMovePct: 1.3, oivMovePct: 1.2, fundingRate: 0.001, cooldownActive: false }).signal).toBe("LONG");
    expect(engine.decide({ priceMovePct: -1.4, oivMovePct: -1.2, fundingRate: -0.001, cooldownActive: false }).signal).toBe("SHORT");
    expect(engine.decide({ priceMovePct: 2, oivMovePct: 2, fundingRate: -0.001, cooldownActive: false }).reason).toBe("funding_mismatch");
  });
});
