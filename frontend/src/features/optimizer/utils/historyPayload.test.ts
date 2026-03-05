import { describe, expect, it } from "vitest";
import { getDatasetHistoryIds } from "./historyPayload";

describe("historyPayload utils", () => {
  it("returns empty list for malformed datasetHistoryIds", () => {
    expect(getDatasetHistoryIds(null)).toEqual([]);
    expect(getDatasetHistoryIds({})).toEqual([]);
    expect(getDatasetHistoryIds({ datasetHistoryIds: "x" })).toEqual([]);
  });

  it("normalizes datasetHistoryIds values safely", () => {
    expect(getDatasetHistoryIds({ datasetHistoryIds: ["a", "", 123, null, " b "] })).toEqual(["a", "123", "b"]);
  });
});
