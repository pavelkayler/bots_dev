import { describe, expect, it } from "vitest";
import { SignalEngine } from "../engine/SignalEngine.js";

describe("SignalEngine", () => {
  it("returns no_refs when references are absent", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: false, directionMode: "both" });
    const decision = engine.decide({ priceMovePct: null, oiMovePct: 1, fundingRate: 1, cooldownActive: false });
    expect(decision.reason).toBe("no_refs");
  });

  it("returns ok when both thresholds pass", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: false, directionMode: "both" });
    const decision = engine.decide({ priceMovePct: 1.2, oiMovePct: 1.1, fundingRate: 0, cooldownActive: false });
    expect(decision.reason).toBe("ok_long");
    expect(decision.signal).toBe("LONG");
  });

  it("enforces funding-sign policy by direction", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: true, directionMode: "both" });
    expect(engine.decide({ priceMovePct: 2, oiMovePct: 2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("ok_long");
    expect(engine.decide({ priceMovePct: -2, oiMovePct: -2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("funding_mismatch");
    expect(engine.decide({ priceMovePct: -2, oiMovePct: -2, fundingRate: -0.01, cooldownActive: false }).reason).toBe("ok_short");
    expect(engine.decide({ priceMovePct: 2, oiMovePct: 2, fundingRate: -0.01, cooldownActive: false }).reason).toBe("funding_mismatch");
  });

  it("blocks on cooldown", () => {
    const engine = new SignalEngine({ priceThresholdPct: 1, oivThresholdPct: 1, requireFundingSign: false, directionMode: "both" });
    const decision = engine.decide({ priceMovePct: 2, oiMovePct: 2, fundingRate: 1, cooldownActive: true });
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
    expect(engine.decide({ priceMovePct: 1.3, oiMovePct: 1.2, fundingRate: 0.001, cooldownActive: false, cvdDelta: 0.5 }).signal).toBe("LONG");
    expect(engine.decide({ priceMovePct: -1.4, oiMovePct: -1.2, fundingRate: -0.001, cooldownActive: false, cvdDelta: -0.5 }).signal).toBe("SHORT");
    expect(engine.decide({ priceMovePct: 2, oiMovePct: 2, fundingRate: -0.001, cooldownActive: false, cvdDelta: 0.5 }).reason).toBe("funding_mismatch");
  });

  it("enforces funding extreme threshold in signal multi-factor mode", () => {
    const engine = new SignalEngine({
      model: "signal-multi-factor-v1",
      priceMovePct: 0.2,
      oiMovePct: 0.2,
      cvdMoveThreshold: 0.1,
      requireFundingExtreme: true,
      fundingMinAbsPct: 0.001,
      requireFundingSign: true,
      directionMode: "both",
    });
    const weakFunding = engine.decide({
      priceMovePct: 1.2,
      oiMovePct: 1.2,
      fundingRate: 0.0002,
      cooldownActive: false,
      cvdDelta: 0.3,
    });
    expect(weakFunding.signal).toBeNull();
    expect(weakFunding.reason).toBe("funding_mismatch");
  });

  it("enforces CVD divergence when required in signal multi-factor mode", () => {
    const engine = new SignalEngine({
      model: "signal-multi-factor-v1",
      priceMovePct: 0.2,
      oiMovePct: 0.2,
      cvdMoveThreshold: 0.1,
      requireFundingExtreme: false,
      requireCvdDivergence: true,
      requireFundingSign: false,
      directionMode: "both",
    });
    const noDivergence = engine.decide({
      priceMovePct: 1.2,
      oiMovePct: 1.2,
      fundingRate: 0,
      cooldownActive: false,
      cvdDelta: 0.3,
      divergencePriceDownCvdUp: false,
    });
    expect(noDivergence.signal).toBeNull();
    expect(noDivergence.reason).toBe("threshold_not_met");

    const withDivergence = engine.decide({
      priceMovePct: 1.2,
      oiMovePct: 1.2,
      fundingRate: 0,
      cooldownActive: false,
      cvdDelta: 0.3,
      divergencePriceDownCvdUp: true,
    });
    expect(withDivergence.signal).toBe("LONG");
    expect(withDivergence.reason).toBe("ok_long");
  });
});
