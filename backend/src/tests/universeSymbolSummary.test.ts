import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUniverseSymbolRangeSummary, computePctChange } from "../universe/universeSymbolSummary.js";

describe("computePctChange", () => {
  it("returns percentage change for valid values", () => {
    expect(computePctChange(120, 100)).toBeCloseTo(20, 6);
    expect(computePctChange(80, 100)).toBeCloseTo(-20, 6);
  });

  it("returns null when previous is zero or values are missing", () => {
    expect(computePctChange(100, 0)).toBeNull();
    expect(computePctChange(null, 100)).toBeNull();
    expect(computePctChange(100, null)).toBeNull();
  });
});

describe("buildUniverseSymbolRangeSummary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates priceChangePct for the selected range and keeps OI metrics", async () => {
    const periodMs = 24 * 60 * 60 * 1000;
    const nowMs = periodMs * 2 + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(nowMs);

    const currentStart = nowMs - periodMs;
    const prevStart = currentStart - periodMs;

    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/v5/market/kline")) {
        const start = Number(url.searchParams.get("start"));
        if (start === currentStart) {
          return {
            ok: true,
            json: async () => ({
              retCode: 0,
              result: {
                list: [
                  [String(currentStart), "0", "130", "90", "120"],
                  [String(currentStart + 60_000), "0", "140", "80", "120"],
                ],
              },
            }),
          } as Response;
        }
        if (start === prevStart) {
          return {
            ok: true,
            json: async () => ({
              retCode: 0,
              result: {
                list: [
                  [String(prevStart), "0", "125", "85", "100"],
                ],
              },
            }),
          } as Response;
        }
      }
      if (url.pathname.endsWith("/v5/market/open-interest")) {
        const start = Number(url.searchParams.get("startTime"));
        if (start === currentStart) {
          return {
            ok: true,
            json: async () => ({ retCode: 0, result: { list: [{ openInterest: "2200" }] } }),
          } as Response;
        }
        if (start === prevStart) {
          return {
            ok: true,
            json: async () => ({ retCode: 0, result: { list: [{ openInterest: "2000" }] } }),
          } as Response;
        }
      }
      return { ok: false, json: async () => ({ retCode: 1 }) } as Response;
    }));

    const summary = await buildUniverseSymbolRangeSummary({
      restBaseUrl: "https://api.bybit.com",
      symbols: ["BTCUSDT"],
      range: "24h",
    });

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      symbol: "BTCUSDT",
      high: 140,
      low: 80,
      openInterestValue: 2200,
      openInterestChangePct: 10,
      priceChangePct: 20,
    });
  });
});
