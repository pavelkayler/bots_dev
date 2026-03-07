import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../dataset/datasetTargetStore.js", async () => {
  const actual = await vi.importActual<typeof import("../dataset/datasetTargetStore.js")>("../dataset/datasetTargetStore.js");
  return {
    ...actual,
    readDatasetTarget: vi.fn(() => ({
      universeId: "u1",
      range: { kind: "preset", preset: "6h" as const },
      interval: "15" as const,
      updatedAtMs: 0,
    })),
    writeDatasetTarget: vi.fn(),
  };
});

import * as datasetTargetStore from "../dataset/datasetTargetStore.js";
import { getActiveReceiveDataJob, startReceiveDataJob } from "../dataset/receiveDataStore.js";

describe("startReceiveDataJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still starts receive job when target persist fails", () => {
    vi.mocked(datasetTargetStore.writeDatasetTarget).mockImplementation(() => {
      throw new Error("open failed");
    });

    const started = startReceiveDataJob({
      universeId: "u1",
      range: { kind: "preset", preset: "6h" },
      interval: "15",
    });

    expect("jobId" in started).toBe(true);
  });

  it("rejects invalid manual range payload", () => {
    const started = startReceiveDataJob({
      universeId: "u1",
      range: { kind: "manual", startMs: 10_000 as any, endMs: 5_000 as any },
      interval: "15",
    });
    expect("error" in started ? started.error : "").toBe("invalid_range");
  });

  it("rejects invalid interval payload", () => {
    const started = startReceiveDataJob({
      universeId: "u1",
      range: { kind: "preset", preset: "6h" },
      interval: "bad" as any,
    });
    expect("error" in started ? started.error : "").toBe("invalid_interval");
  });

  it("exposes active queued receive job in process status path", () => {
    const started = startReceiveDataJob({
      universeId: "u1",
      range: { kind: "preset", preset: "6h" },
      interval: "15",
    });
    expect("jobId" in started).toBe(true);
    const active = getActiveReceiveDataJob();
    expect(active?.id).toBeTruthy();
    expect(active?.status === "queued" || active?.status === "running").toBe(true);
  });
});
