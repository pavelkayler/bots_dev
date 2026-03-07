import { describe, expect, it } from "vitest";
import { resolveOptimizerDatasetWindow } from "../api/http.js";

describe("resolveOptimizerDatasetWindow", () => {
  it("keeps snapshot mode payload without forcing time bounds", () => {
    const out = resolveOptimizerDatasetWindow({
      datasetMode: "snapshot",
      datasetHistoryIds: ["h1"],
      candidates: 100,
    }, 1_000_000);

    expect(out.datasetMode).toBe("snapshot");
    expect((out as any).timeRangeFromTs).toBeUndefined();
    expect((out as any).timeRangeToTs).toBeUndefined();
  });

  it("resolves follow tail end to now", () => {
    const out = resolveOptimizerDatasetWindow({
      datasetMode: "followTail",
      timeRangeFromTs: 900_000,
      timeRangeToTs: 950_000,
      datasetHistoryIds: ["h1"],
      candidates: 100,
    }, 1_000_000);

    expect(out.datasetMode).toBe("followTail");
    expect((out as any).timeRangeFromTs).toBe(900_000);
    expect((out as any).timeRangeToTs).toBe(1_000_000);
  });

  it("rejects follow tail without valid start", () => {
    expect(() => resolveOptimizerDatasetWindow({
      datasetMode: "followTail",
      datasetHistoryIds: ["h1"],
      candidates: 100,
    }, 1_000_000)).toThrow("invalid_follow_tail_start");
  });
});

