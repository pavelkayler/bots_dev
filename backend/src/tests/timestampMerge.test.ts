import { describe, expect, it } from "vitest";
import { mergeFieldLayerByTimestamp, upsertTimestampFields } from "../dataset/timestampMerge.js";

describe("timestamp merge helpers", () => {
  it("upsertTimestampFields extends existing timestamp row instead of replacing it", () => {
    const rows = new Map<number, any>();
    const ts = Date.UTC(2026, 2, 6, 12, 0, 0, 0);

    upsertTimestampFields(rows, ts, {
      startMs: ts,
      open: "10",
      close: "11",
      oi: "1000",
      oiSource: "bybit",
    });
    upsertTimestampFields(rows, ts, {
      startMs: ts,
      open: "12",
      close: "13",
    });

    const row = rows.get(ts);
    expect(row?.open).toBe("12");
    expect(row?.close).toBe("13");
    expect(row?.oi).toBe("1000");
    expect(row?.oiSource).toBe("bybit");
  });

  it("mergeFieldLayerByTimestamp adds partial fields by timestamp while preserving base row", () => {
    const rows = [
      { startMs: 1, close: "1.0", oi: "10" },
      { startMs: 2, close: "2.0", oi: null as string | null },
    ];
    const layer = new Map<number, Record<string, unknown>>([
      [2, { oi: "20", oiSource: "recorder" }],
    ]);
    const merged = mergeFieldLayerByTimestamp(rows, layer);
    expect(merged[0]).toEqual({ startMs: 1, close: "1.0", oi: "10" });
    expect(merged[1]).toEqual({ startMs: 2, close: "2.0", oi: "20", oiSource: "recorder" });
  });
});
