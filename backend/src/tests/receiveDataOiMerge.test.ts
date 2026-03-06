import { describe, expect, it } from "vitest";
import { applyBybitLastKnownOiToCandles, applyOiSourcesToCandles } from "../dataset/receiveDataStore.js";

function makeCandles(startMs: number, minutes: number) {
  const out: Array<{ startMs: number; close: string; oi?: string; oiSource?: string }> = [];
  for (let i = 0; i < minutes; i += 1) {
    out.push({ startMs: startMs + i * 60_000, close: "100" });
  }
  return out;
}

describe("receive data OI merge", () => {
  it("preserves Bybit 5m OI and fills only intermediate minutes from CoinGlass", () => {
    const candles = makeCandles(0, 11);
    const bybit = new Map<number, string>([
      [0, "1000"],
      [5 * 60_000, "2000"],
      [10 * 60_000, "3000"],
    ]);
    const coinglass = new Map<number, string>();
    for (let m = 1; m < 10; m += 1) {
      if (m % 5 === 0) continue;
      coinglass.set(m * 60_000, String(1000 + m));
    }
    coinglass.set(5 * 60_000, "999999");

    const result = applyOiSourcesToCandles({ candles, bybitOi5m: bybit, coinglassOi1m: coinglass });
    expect(result.missingMinutes).toHaveLength(0);
    expect(candles[0]?.oi).toBe("1000");
    expect(candles[5]?.oi).toBe("2000");
    expect(candles[10]?.oi).toBe("3000");
    expect(candles[5]?.oiSource).toBe("bybit");
    expect(candles[1]?.oiSource).toBe("coinglass");
  });

  it("reports incomplete minute OI coverage when intermediate minutes are missing", () => {
    const candles = makeCandles(0, 6);
    const bybit = new Map<number, string>([
      [0, "1000"],
      [5 * 60_000, "2000"],
    ]);
    const coinglass = new Map<number, string>([
      [1 * 60_000, "1001"],
      [2 * 60_000, "1002"],
    ]);

    const result = applyOiSourcesToCandles({ candles, bybitOi5m: bybit, coinglassOi1m: coinglass });
    expect(result.missingMinutes).toEqual([3 * 60_000, 4 * 60_000]);
    expect(candles[3]?.oi).toBeUndefined();
    expect(candles[4]?.oi).toBeUndefined();
  });

  it("fills minute candles from Bybit last-known OI in bybit-only mode", () => {
    const candles = makeCandles(0, 6);
    const bybit = new Map<number, string>([
      [0, "1000"],
      [5 * 60_000, "2000"],
    ]);
    applyBybitLastKnownOiToCandles({ candles, bybitOi5m: bybit });
    expect(candles[0]?.oi).toBe("1000");
    expect(candles[1]?.oi).toBe("1000");
    expect(candles[2]?.oi).toBe("1000");
    expect(candles[3]?.oi).toBe("1000");
    expect(candles[4]?.oi).toBe("1000");
    expect(candles[5]?.oi).toBe("2000");
  });
});
