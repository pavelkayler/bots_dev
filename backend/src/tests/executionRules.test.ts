import { describe, expect, it } from "vitest";
import { evaluateLimitFill, evaluateTpSl } from "../execution/executionRules.js";

describe("executionRules", () => {
  it("fills conservative limit using candle extremes", () => {
    expect(evaluateLimitFill({
      ohlc: { open: 100, high: 102, low: 98, close: 101 },
      markPrice: 101,
      limitPrice: 99,
      side: "LONG",
      mode: "conservativeOhlc",
    })).toBe(true);
  });

  it("uses worst-case tie-break for conservative TP/SL overlap", () => {
    const decision = evaluateTpSl({
      ohlc: { open: 100, high: 110, low: 90, close: 100 },
      markPrice: 100,
      entryPrice: 100,
      tpPrice: 108,
      slPrice: 92,
      side: "LONG",
      mode: "conservativeOhlc",
      tieBreakRule: "worstCase",
    });
    expect(decision.closeType).toBe("SL");
    expect(decision.closePrice).toBe(92);
  });
});
