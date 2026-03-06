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
import { startReceiveDataJob } from "../dataset/receiveDataStore.js";

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
});
