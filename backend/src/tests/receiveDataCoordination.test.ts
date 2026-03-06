import { describe, expect, it } from "vitest";
import { CoinGlassRateLimitError } from "../coinglass/CoinGlassClient.js";
import {
  SequentialCoinGlassHandoff,
  estimateReceiveEtaSec,
  isRetryableCoinGlassError,
} from "../dataset/receiveDataStore.js";

describe("receive data coordination helpers", () => {
  it("follows sequential handoff: CoinGlass symbol K starts only after Bybit advances", () => {
    const handoff = new SequentialCoinGlassHandoff();
    const triggered: Array<string | null> = [];

    triggered.push(handoff.onBybitSymbolCompleted("BTCUSDT"));
    triggered.push(handoff.onBybitSymbolCompleted("ETHUSDT"));
    triggered.push(handoff.onBybitSymbolCompleted("SOLUSDT"));
    triggered.push(handoff.drainPending());
    triggered.push(handoff.drainPending());

    expect(triggered).toEqual([null, "BTCUSDT", "ETHUSDT", "SOLUSDT", null]);
  });

  it("does not classify temporary rate-limit waiting as terminal failure", () => {
    expect(isRetryableCoinGlassError(new CoinGlassRateLimitError("limit", 5))).toBe(true);
    expect(isRetryableCoinGlassError(new Error("other"))).toBe(false);
  });

  it("estimates ETA in normal progress, waiting, and final drain states", () => {
    const startedAtMs = 0;
    const normalEta = estimateReceiveEtaSec({
      startedAtMs,
      completedSteps: 10,
      totalSteps: 20,
      nowMs: 10_000,
    });
    const waitingEta = estimateReceiveEtaSec({
      startedAtMs,
      completedSteps: 10,
      totalSteps: 20,
      waitUntilMs: 40_000,
      nowMs: 10_000,
    });
    const drainEta = estimateReceiveEtaSec({
      startedAtMs,
      completedSteps: 19,
      totalSteps: 20,
      nowMs: 20_000,
    });

    expect(normalEta).toBeGreaterThan(0);
    expect(waitingEta).toBeGreaterThan(normalEta ?? 0);
    expect(drainEta).toBeGreaterThan(0);
  });
});
