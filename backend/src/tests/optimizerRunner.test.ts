import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SignalEngine } from "../engine/SignalEngine.js";
import {
  buildCandidateKey,
  createReplayEventsFromCacheRows,
  deriveWindowOiValue,
  flushNegativeBlacklist,
  fundingRateAtTs,
  loadNegativeBlacklist,
  runOptimizationCore,
} from "../optimizer/runner.js";

const cwdStack: string[] = [];

function pushTempCwd() {
  const prev = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runner-tests-"));
  cwdStack.push(prev);
  process.chdir(tmp);
  return tmp;
}

afterEach(() => {
  const prev = cwdStack.pop();
  const current = process.cwd();
  if (prev) {
    process.chdir(prev);
    fs.rmSync(current, { recursive: true, force: true });
  }
});

describe("optimizer runner helpers", () => {
  it("replay emits close-only market ticks and uses OI * close with no fallback", () => {
    const rows = [
      { startMs: 60_000, close: "100", oi: "2" },
      { startMs: 120_000, close: "105", oi: "0" },
      { startMs: 180_000, close: "110" },
    ];
    const replay = createReplayEventsFromCacheRows({
      rows,
      windows: [{ startMs: 0, endMs: 999_999 }],
      replayIntervalMin: 1,
      symbol: "BTCUSDT",
      fundingSamples: [],
    });

    const tickerEvents = replay.events.filter((ev) => ev.type === "ticker");
    expect(tickerEvents.map((ev) => ev.ts)).toEqual([120_000, 180_000, 240_000]);
    expect(tickerEvents[0]?.payload?.openInterestValue).toBe(200);
    expect(tickerEvents[1]?.payload?.openInterestValue).toBe(0);
    expect(tickerEvents[2]?.payload?.openInterestValue).toBe(0);
  });

  it("fundingRateAtTs returns last-known sample and funding sign gates decisions", () => {
    const samples = [
      { ts: 1_000, rate: 0.01 },
      { ts: 2_000, rate: -0.02 },
      { ts: 3_000, rate: 0.03 },
    ];
    expect(fundingRateAtTs(samples, 500)).toBe(0);
    expect(fundingRateAtTs(samples, 2_500)).toBe(-0.02);
    expect(fundingRateAtTs(samples, 3_000)).toBe(0.03);

    const engine = new SignalEngine({
      priceThresholdPct: 1,
      oivThresholdPct: 1,
      requireFundingSign: true,
      directionMode: "both",
    });
    expect(engine.decide({ priceMovePct: 2, oiMovePct: 2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("ok_long");
    expect(engine.decide({ priceMovePct: -2, oiMovePct: -2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("funding_mismatch");
  });

  it("candidate key is deterministic and blacklist persists round-trip", () => {
    pushTempCwd();
    const keyA = buildCandidateKey(
      { priceThresholdPct: 1, oivThresholdPct: 1, tpRoiPct: 2, slRoiPct: 1, entryOffsetPct: 0, timeoutSec: 61, rearmMs: 60_000 },
      "both",
      15,
      { marginPerTrade: 20, leverage: 10, feeBps: 1, slippageBps: 0 }
    );
    const keyB = buildCandidateKey(
      { priceThresholdPct: 1, oivThresholdPct: 1, tpRoiPct: 2, slRoiPct: 1, entryOffsetPct: 0, timeoutSec: 61, rearmMs: 60_000 },
      "both",
      15,
      { marginPerTrade: 20, leverage: 10, feeBps: 1, slippageBps: 0 }
    );
    expect(keyA).toBe(keyB);

    const state = loadNegativeBlacklist("run:key");
    state.negativeSet.add(keyA);
    flushNegativeBlacklist(state);
    const loaded = loadNegativeBlacklist("run:key");
    expect(loaded.negativeSet.has(keyA)).toBe(true);
  });

  it("rememberNegatives semantics skip repeated key and persist run metadata", () => {
    pushTempCwd();
    const params = { priceThresholdPct: 0.1, oivThresholdPct: 0.1, tpRoiPct: 1, slRoiPct: 1, entryOffsetPct: 0, timeoutSec: 61, rearmMs: 60_000 };
    const key = buildCandidateKey(params, "both", 15, { marginPerTrade: 20, leverage: 10, feeBps: 1, slippageBps: 0 });

    const state = loadNegativeBlacklist("run:key:2");
    state.negativeSet.add(key);
    state.runIndex = 3;
    flushNegativeBlacklist(state);

    const loaded = loadNegativeBlacklist("run:key:2");
    expect(loaded.runIndex).toBe(3);
    expect(loaded.negativeSet.has(key)).toBe(true);

    let skipped = 0;
    const candidateKeys = [key, key, "other"];
    for (const candidateKey of candidateKeys) {
      if (loaded.negativeSet.has(candidateKey)) {
        skipped += 1;
        continue;
      }
    }
    expect(skipped).toBe(2);
  });

  it("supports optimizer tf 5 and 10 with minute cache replay", async () => {
    pushTempCwd();
    const dir = path.join(process.cwd(), "data", "cache", "bybit_klines", "1");
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, "BTCUSDT.jsonl");
    const rows = [
      { symbol: "BTCUSDT", startMs: 0, open: "100", high: "101", low: "99", close: "100", oi: "10" },
      { symbol: "BTCUSDT", startMs: 60_000, open: "101", high: "102", low: "100", close: "101", oi: "11" },
      { symbol: "BTCUSDT", startMs: 120_000, open: "102", high: "103", low: "101", close: "102", oi: "12" },
      { symbol: "BTCUSDT", startMs: 180_000, open: "103", high: "104", low: "102", close: "103", oi: "13" },
      { symbol: "BTCUSDT", startMs: 240_000, open: "104", high: "105", low: "103", close: "104", oi: "14" },
      { symbol: "BTCUSDT", startMs: 300_000, open: "105", high: "106", low: "104", close: "105", oi: "15" },
      { symbol: "BTCUSDT", startMs: 360_000, open: "106", high: "107", low: "105", close: "106", oi: "16" },
      { symbol: "BTCUSDT", startMs: 420_000, open: "107", high: "108", low: "106", close: "107", oi: "17" },
      { symbol: "BTCUSDT", startMs: 480_000, open: "108", high: "109", low: "107", close: "108", oi: "18" },
      { symbol: "BTCUSDT", startMs: 540_000, open: "109", high: "110", low: "108", close: "109", oi: "19" },
      { symbol: "BTCUSDT", startMs: 600_000, open: "110", high: "111", low: "109", close: "110", oi: "20" },
    ];
    fs.writeFileSync(fp, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

    const out5 = await runOptimizationCore({
      candidates: 1,
      seed: 1,
      directionMode: "both",
      optTfMin: 5,
      fixedParams: { priceThresholdPct: 0.1, oivThresholdPct: 0.1, tpRoiPct: 1, slRoiPct: 1, entryOffsetPct: 0, timeoutSec: 61, rearmMs: 60_000 },
      cacheDataset: { symbols: ["BTCUSDT"], startMs: 0, endMs: 600_000, interval: "1" },
    });
    const out10 = await runOptimizationCore({
      candidates: 1,
      seed: 2,
      directionMode: "both",
      optTfMin: 10,
      fixedParams: { priceThresholdPct: 0.1, oivThresholdPct: 0.1, tpRoiPct: 1, slRoiPct: 1, entryOffsetPct: 0, timeoutSec: 61, rearmMs: 60_000 },
      cacheDataset: { symbols: ["BTCUSDT"], startMs: 0, endMs: 600_000, interval: "1" },
    });
    expect(out5.cancelled).toBe(false);
    expect(out5.results.length).toBeGreaterThanOrEqual(1);
    expect(out10.cancelled).toBe(false);
    expect(out10.results.length).toBeGreaterThanOrEqual(1);
  });

  it("uses minute-level OI path aggregation for higher tf windows", () => {
    const minutePath = [100, 110, 150, 130, 120];
    const derived = deriveWindowOiValue(minutePath, 120);
    expect(derived).toBe(122);
    expect(derived).not.toBe(120);
  });

  it("falls back to dataset interval cache when 1m cache is unavailable", async () => {
    pushTempCwd();
    const dir = path.join(process.cwd(), "data", "cache", "bybit_klines", "5");
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, "BTCUSDT.jsonl");
    const rows = [
      { symbol: "BTCUSDT", startMs: 0, open: "100", high: "101", low: "99", close: "100", oi: "10" },
      { symbol: "BTCUSDT", startMs: 300_000, open: "101", high: "102", low: "100", close: "101", oi: "11" },
      { symbol: "BTCUSDT", startMs: 600_000, open: "102", high: "103", low: "101", close: "102", oi: "12" },
      { symbol: "BTCUSDT", startMs: 900_000, open: "103", high: "104", low: "102", close: "103", oi: "13" },
    ];
    fs.writeFileSync(fp, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

    const out = await runOptimizationCore({
      candidates: 1,
      seed: 3,
      directionMode: "both",
      optTfMin: 10,
      fixedParams: { priceThresholdPct: 0.1, oivThresholdPct: 0.1, tpRoiPct: 1, slRoiPct: 1, entryOffsetPct: 0, timeoutSec: 61, rearmMs: 60_000 },
      cacheDataset: { symbols: ["BTCUSDT"], startMs: 0, endMs: 900_000, interval: "5" },
    });
    expect(out.cancelled).toBe(false);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
  });
});
