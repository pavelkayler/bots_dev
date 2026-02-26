import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalCwd = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bots-dev-invariants-"));

let configStore: any;
let SignalEngine: any;

before(async () => {
  process.chdir(tempRoot);
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  ({ configStore } = await import("../runtime/configStore.js"));
  ({ SignalEngine } = await import("../engine/SignalEngine.js"));
});

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("configStore forces signals.requireFundingSign=true on update", () => {
  const next = configStore.update({ signals: { requireFundingSign: false } });
  assert.equal(next.signals.requireFundingSign, true);
});

test("SignalEngine funding sign gating returns funding_mismatch", () => {
  const engine = new SignalEngine({
    priceThresholdPct: 1,
    oivThresholdPct: 1,
    requireFundingSign: true,
    directionMode: "both",
  });

  const longBlocked = engine.decide({ priceMovePct: 2, oivMovePct: 2, fundingRate: 0, cooldownActive: false });
  assert.equal(longBlocked.signal, null);
  assert.equal(longBlocked.reason, "funding_mismatch");

  const shortBlocked = engine.decide({ priceMovePct: -2, oivMovePct: -2, fundingRate: 0, cooldownActive: false });
  assert.equal(shortBlocked.signal, null);
  assert.equal(shortBlocked.reason, "funding_mismatch");
});

test("SignalEngine directionMode short blocks long signal", () => {
  const engine = new SignalEngine({
    priceThresholdPct: 1,
    oivThresholdPct: 1,
    requireFundingSign: false,
    directionMode: "short",
  });

  const blocked = engine.decide({ priceMovePct: 2, oivMovePct: 2, fundingRate: 1, cooldownActive: false });
  assert.equal(blocked.signal, null);
});
