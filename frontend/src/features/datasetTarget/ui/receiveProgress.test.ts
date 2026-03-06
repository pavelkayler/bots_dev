import { describe, expect, it } from "vitest";
import { formatReceiveProgressLine } from "./receiveProgress";

describe("formatReceiveProgressLine", () => {
  it("formats progress with message including CoinGlass wait text", () => {
    const line = formatReceiveProgressLine({
      id: "job-1",
      status: "running",
      progress: {
        pct: 10,
        completedSteps: 2,
        totalSteps: 20,
        currentSymbol: "BTCUSDT",
        message: "CoinGlass limit resets in 12 sec",
        etaSec: 310,
      },
    });
    expect(line).toContain("2/20");
    expect(line).toContain("BTCUSDT");
    expect(line).toContain("CoinGlass limit resets in 12 sec");
    expect(line).toContain("ETA: ~5m 10s");
  });

  it("returns empty string when job is missing", () => {
    expect(formatReceiveProgressLine(null)).toBe("");
  });
});
