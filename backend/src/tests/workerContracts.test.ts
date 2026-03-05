import { describe, expect, test } from "vitest";
import { canEmitProgress, clampWorkerProgressPercent, workerMessageSchema } from "../optimizer/worker/contracts.js";

describe("optimizer worker message contracts", () => {
  test("progress message includes required fields", () => {
    const parsed = workerMessageSchema.parse({
      type: "progress",
      jobId: "job-1",
      donePercent: 42.5,
      done: 85,
      total: 200,
      updatedAtMs: Date.now(),
      previewResults: [],
    });
    expect(parsed.type).toBe("progress");
  });

  test("progress throttle helper enforces minimum interval", () => {
    expect(canEmitProgress(0, 1000, 75)).toBe(true);
    expect(canEmitProgress(1000, 1040, 75)).toBe(false);
    expect(canEmitProgress(1000, 1075, 75)).toBe(true);
  });

  test("progress percent clamping is bounded", () => {
    expect(clampWorkerProgressPercent(-1)).toBe(0);
    expect(clampWorkerProgressPercent(101)).toBe(100);
  });
});
