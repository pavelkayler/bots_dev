import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MinuteOiRecorder, mergeMinuteOiByTimestamp } from "../recorder/MinuteOiRecorder.js";

const tempDirs: string[] = [];

function mkTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minute-oi-recorder-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("MinuteOiRecorder", () => {
  it("writes only intermediate minute OI points and skips 5-minute boundaries", () => {
    const recorder = new MinuteOiRecorder(mkTempDir());
    recorder.setMode("record_while_running");
    recorder.activate(["BTCUSDT"]);
    const base = Date.UTC(2026, 2, 6, 12, 0, 0, 0);

    const wroteBoundary = recorder.ingestTicker({
      symbol: "BTCUSDT",
      openInterestValue: 1200,
      tsMs: base,
    });
    const wroteIntermediate = recorder.ingestTicker({
      symbol: "BTCUSDT",
      openInterestValue: 1250,
      tsMs: base + 60_000,
    });
    const wroteDuplicateMinute = recorder.ingestTicker({
      symbol: "BTCUSDT",
      openInterestValue: 1255,
      tsMs: base + 60_000 + 10_000,
    });

    expect(wroteBoundary).toBe(false);
    expect(wroteIntermediate).toBe(true);
    expect(wroteDuplicateMinute).toBe(false);

    const rows = recorder.readSymbolRows("BTCUSDT");
    expect(rows.size).toBe(1);
    expect(rows.get(base + 60_000)?.openInterestValue).toBe(1250);
    expect(recorder.getStatus().droppedBoundaryPoints).toBe(1);
  });

  it("supports record_only and record_while_running modes safely", () => {
    const recorder = new MinuteOiRecorder(mkTempDir());
    const minuteTs = Date.UTC(2026, 2, 6, 12, 1, 0, 0);

    recorder.setMode("record_only");
    recorder.activate(["ETHUSDT"]);
    const wroteRecordOnly = recorder.ingestTicker({
      symbol: "ETHUSDT",
      openInterestValue: 777,
      tsMs: minuteTs,
    });
    expect(wroteRecordOnly).toBe(true);
    expect(recorder.getStatus().mode).toBe("record_only");

    recorder.setMode("record_while_running");
    recorder.deactivate();
    const wroteWhenInactive = recorder.ingestTicker({
      symbol: "ETHUSDT",
      openInterestValue: 888,
      tsMs: minuteTs + 60_000,
    });
    expect(wroteWhenInactive).toBe(false);
    expect(recorder.getStatus().state).toBe("waiting");

    recorder.activate(["ETHUSDT"]);
    const wroteWhenRuntimeActive = recorder.ingestTicker({
      symbol: "ETHUSDT",
      openInterestValue: 999,
      tsMs: minuteTs + 60_000,
    });
    expect(wroteWhenRuntimeActive).toBe(true);
    expect(recorder.getStatus().mode).toBe("record_while_running");
  });

  it("records only symbols from tracked recorder universe", () => {
    const recorder = new MinuteOiRecorder(mkTempDir());
    recorder.setMode("record_only");
    recorder.activate(["BTCUSDT"]);
    const base = Date.UTC(2026, 2, 6, 12, 1, 0, 0);

    const wroteAllowed = recorder.ingestTicker({
      symbol: "BTCUSDT",
      openInterestValue: 1000,
      tsMs: base,
    });
    const wroteBlocked = recorder.ingestTicker({
      symbol: "ETHUSDT",
      openInterestValue: 1000,
      tsMs: base + 60_000,
    });

    expect(wroteAllowed).toBe(true);
    expect(wroteBlocked).toBe(false);
    expect(recorder.readSymbolRows("BTCUSDT").size).toBe(1);
    expect(recorder.readSymbolRows("ETHUSDT").size).toBe(0);
  });

  it("stores minute OI in daily chunk files and reads merged rows", () => {
    const root = mkTempDir();
    const recorder = new MinuteOiRecorder(root);
    recorder.setMode("record_only");
    recorder.activate(["BTCUSDT"]);

    const day1 = Date.UTC(2026, 2, 6, 12, 1, 0, 0);
    const day2 = Date.UTC(2026, 2, 7, 12, 1, 0, 0);
    recorder.ingestTicker({ symbol: "BTCUSDT", openInterestValue: 1111, tsMs: day1 });
    recorder.ingestTicker({ symbol: "BTCUSDT", openInterestValue: 2222, tsMs: day2 });

    const day1Path = path.join(root, "BTCUSDT", "2026-03-06.jsonl");
    const day2Path = path.join(root, "BTCUSDT", "2026-03-07.jsonl");
    expect(fs.existsSync(day1Path)).toBe(true);
    expect(fs.existsSync(day2Path)).toBe(true);

    const rows = recorder.readSymbolRows("BTCUSDT");
    expect(rows.get(day1)?.openInterestValue).toBe(1111);
    expect(rows.get(day2)?.openInterestValue).toBe(2222);
  });

  it("merges recorder minute OI by timestamp without replacing existing boundary rows", () => {
    const minuteOi = new Map([
      [Date.UTC(2026, 2, 6, 12, 1, 0, 0), { ts: Date.UTC(2026, 2, 6, 12, 1, 0, 0), openInterestValue: 2100, source: "bybit_ws" as const, recordedAtMs: Date.now() }],
      [Date.UTC(2026, 2, 6, 12, 5, 0, 0), { ts: Date.UTC(2026, 2, 6, 12, 5, 0, 0), openInterestValue: 9999, source: "bybit_ws" as const, recordedAtMs: Date.now() }],
    ]);
    const rows = [
      { startMs: Date.UTC(2026, 2, 6, 12, 0, 0, 0), openInterestValue: 1000, markPrice: 1 },
      { startMs: Date.UTC(2026, 2, 6, 12, 1, 0, 0), openInterestValue: null as number | null, markPrice: 2 },
      { startMs: Date.UTC(2026, 2, 6, 12, 5, 0, 0), openInterestValue: null as number | null, markPrice: 3 },
    ];

    const merged = mergeMinuteOiByTimestamp(rows, minuteOi);
    expect(merged[0]?.openInterestValue).toBe(1000);
    expect(merged[1]?.openInterestValue).toBe(2100);
    expect(merged[2]?.openInterestValue).toBeNull();
  });
});
