import { describe, expect, it } from "vitest";
import {
  CoinGlassClient,
  CoinGlassLimiter,
  resolveCoinGlassBybitSymbol,
  validateCoinGlassBybitSymbols,
} from "../coinglass/CoinGlassClient.js";

describe("CoinGlass limiter and client", () => {
  it("enforces 30 requests per minute window deterministically", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new CoinGlassLimiter({
      maxRequests: 30,
      windowMs: 60_000,
      nowFn: () => now,
      sleepFn: async (ms: number) => {
        waits.push(ms);
        now += ms;
      },
    });

    for (let i = 0; i < 30; i += 1) {
      const waited = await limiter.acquire();
      expect(waited).toBe(0);
    }
    const waited = await limiter.acquire();
    expect(waited).toBe(60_000);
    expect(waits).toEqual([60_000]);
  });

  it("maps and validates canonical Bybit USDT symbols", () => {
    expect(resolveCoinGlassBybitSymbol("BTCUSDT")).toBe("BTCUSDT");
    expect(resolveCoinGlassBybitSymbol("ETHUSDT")).toBe("ETHUSDT");
    expect(resolveCoinGlassBybitSymbol("BTCUSD")).toBeNull();

    const checked = validateCoinGlassBybitSymbols(["BTCUSDT", "ETHUSDT", "BAD-SYMBOL"]);
    expect(checked.mapped.BTCUSDT).toBe("BTCUSDT");
    expect(checked.mapped.ETHUSDT).toBe("ETHUSDT");
    expect(checked.unsupported).toContain("BAD-SYMBOL");
  });

  it("throws clear error when API key is missing", async () => {
    const client = new CoinGlassClient({
      apiKey: "",
      fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }),
    });
    await expect(client.fetchBybitOpenInterest1m({
      bybitSymbol: "BTCUSDT",
      startMs: 0,
      endMs: 60_000,
    })).rejects.toMatchObject({ name: "CoinGlassClientError", code: "coinglass_key_missing" });
  });

  it("throws clear error for unsupported symbol mapping", async () => {
    const client = new CoinGlassClient({
      apiKey: "x",
      fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }),
    });
    await expect(client.fetchBybitOpenInterest1m({
      bybitSymbol: "BTCUSD",
      startMs: 0,
      endMs: 60_000,
    })).rejects.toMatchObject({ name: "CoinGlassClientError", code: "coinglass_symbol_unsupported" });
  });

  it("parses points and invokes wait callback after limiter saturation", async () => {
    let now = 0;
    const limiter = new CoinGlassLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      nowFn: () => now,
      sleepFn: async (ms: number) => {
        now += ms;
      },
    });
    const waits: number[] = [];
    const client = new CoinGlassClient({
      apiKey: "x",
      limiter,
      fetchImpl: async () => new Response(JSON.stringify({
        code: 0,
        data: [{ timestamp: 1_700_000_000, openInterest: "123.45" }],
      }), { status: 200 }),
    });

    const first = await client.fetchBybitOpenInterest1m({
      bybitSymbol: "BTCUSDT",
      startMs: 0,
      endMs: 60_000,
      onRateLimitWait: (sec) => waits.push(sec),
    });
    expect(first).toHaveLength(1);

    const second = await client.fetchBybitOpenInterest1m({
      bybitSymbol: "BTCUSDT",
      startMs: 60_000,
      endMs: 120_000,
      onRateLimitWait: (sec) => waits.push(sec),
    });
    expect(second).toHaveLength(1);
    expect(waits).toContain(60);
  });
});
