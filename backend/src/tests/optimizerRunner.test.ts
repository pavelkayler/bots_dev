import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SignalEngine } from "../engine/SignalEngine.js";
import {
  buildCandidateKey,
  createReplayEventsFromCacheRows,
  flushNegativeBlacklist,
  fundingRateAtTs,
  loadNegativeBlacklist,
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
    expect(engine.decide({ priceMovePct: 2, oivMovePct: 2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("ok_long");
    expect(engine.decide({ priceMovePct: -2, oivMovePct: -2, fundingRate: 0.01, cooldownActive: false }).reason).toBe("funding_mismatch");
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
});
