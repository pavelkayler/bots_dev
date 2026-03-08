import { describe, expect, it, vi, beforeEach } from "vitest";
import { getCurrentJob, getOptimizerJobHistory } from "./optimizerApi";

const { getJsonMock, postJsonMock } = vi.hoisted(() => ({
  getJsonMock: vi.fn<(url: string) => Promise<{ total: number; items: unknown[]; jobId: string | null }>>(
    async () => ({ total: 0, items: [], jobId: null }),
  ),
  postJsonMock: vi.fn<(url: string, payload: unknown) => Promise<unknown>>(async () => ({})),
}));

vi.mock("../../../shared/config/env", () => ({
  getApiBase: () => "http://localhost:8080",
}));

vi.mock("../../../shared/api/http", () => ({
  getJson: getJsonMock,
  postJson: postJsonMock,
}));

describe("optimizerApi bot scoping", () => {
  beforeEach(() => {
    getJsonMock.mockClear();
    postJsonMock.mockClear();
  });

  it("passes botId in optimizer history query", async () => {
    await getOptimizerJobHistory({ limit: 25, botId: "signal-multi-factor-v1" });
    const calledUrl = String(getJsonMock.mock.calls.at(0)?.at(0) ?? "");
    expect(calledUrl).toContain("/api/optimizer/jobs/history?");
    expect(calledUrl).toContain("botId=signal-multi-factor-v1");
  });

  it("passes botId when requesting current optimizer job", async () => {
    await getCurrentJob("oi-momentum-v1");
    const calledUrl = String(getJsonMock.mock.calls.at(0)?.at(0) ?? "");
    expect(calledUrl).toContain("/api/optimizer/jobs/current?botId=oi-momentum-v1");
  });
});
