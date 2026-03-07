import { describe, expect, it } from "vitest";
import { validateLoopStartInput } from "./inputValidation";

describe("validateLoopStartInput", () => {
  it("accepts valid payload", () => {
    expect(validateLoopStartInput({
      candidates: "200",
      seed: "1",
      minTrades: "0",
      optTfMin: "15",
      loopRunsCount: "3",
      simMarginPerTrade: "100",
      simLeverage: "10",
    })).toBeNull();
  });

  it("rejects invalid numeric ranges", () => {
    expect(validateLoopStartInput({
      candidates: "0",
      seed: "1",
      minTrades: "0",
      optTfMin: "15",
      loopRunsCount: "3",
      simMarginPerTrade: "100",
      simLeverage: "10",
    })).toContain("Candidates");

    expect(validateLoopStartInput({
      candidates: "10",
      seed: "-1",
      minTrades: "0",
      optTfMin: "15",
      loopRunsCount: "3",
      simMarginPerTrade: "100",
      simLeverage: "10",
    })).toContain("Seed");

    expect(validateLoopStartInput({
      candidates: "10",
      seed: "1",
      minTrades: "0",
      optTfMin: "4",
      loopRunsCount: "3",
      simMarginPerTrade: "100",
      simLeverage: "10",
    })).toContain("Signal window");
  });
});
