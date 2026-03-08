import { describe, expect, it } from "vitest";
import { aggregateOptimizerHistorySessions, filterOptimizerHistoryByBot } from "../api/http.js";

describe("aggregateOptimizerHistorySessions", () => {
  it("collapses loop runs into one session row and keeps single runs", () => {
    const base = [
      {
        jobId: "job-a",
        mode: "loop",
        loopId: "loop-1",
        historyType: "run",
        endedAtMs: 200,
        status: "done",
        runPayload: { datasetHistoryIds: ["d1"], candidates: 10, seed: 1, minTrades: 1, directionMode: "both", rememberNegatives: false, excludeNegative: false },
        summary: { bestNetPnl: 10, bestTrades: 3, bestWinRate: 50, bestProfitFactor: 1.1, bestMaxDD: 2, rowsPositive: 2, rowsTotal: 5 },
      },
      {
        jobId: "job-b",
        mode: "loop",
        loopId: "loop-1",
        historyType: "run",
        endedAtMs: 100,
        status: "done",
        runPayload: { datasetHistoryIds: ["d1"], candidates: 10, seed: 2, minTrades: 1, directionMode: "both", rememberNegatives: false, excludeNegative: false },
        summary: { bestNetPnl: 15, bestTrades: 4, bestWinRate: 55, bestProfitFactor: 1.2, bestMaxDD: 2, rowsPositive: 3, rowsTotal: 7 },
      },
      {
        jobId: "job-single",
        mode: "single",
        historyType: "run",
        endedAtMs: 150,
        status: "done",
        runPayload: { datasetHistoryIds: ["d2"], candidates: 10, seed: 1, minTrades: 1, directionMode: "both", rememberNegatives: false, excludeNegative: false },
        summary: { bestNetPnl: 5, bestTrades: 2, bestWinRate: 40, bestProfitFactor: 1.0, bestMaxDD: 1, rowsPositive: 1, rowsTotal: 2 },
      },
    ] as any[];

    const out = aggregateOptimizerHistorySessions(base);
    const session = out.find((row) => row.historyType === "session");
    const single = out.find((row) => row.jobId === "job-single");

    expect(session?.jobId).toBe("loop:loop-1");
    expect(session?.sessionRunsTotal).toBe(2);
    expect(session?.summary.rowsTotal).toBe(12);
    expect(session?.summary.rowsPositive).toBe(5);
    expect(session?.summary.bestNetPnl).toBe(15);
    expect(session?.childJobIds).toEqual(["job-a", "job-b"]);
    expect(session?.childRuns?.length).toBe(2);
    expect(single?.historyType).toBe("run");
  });
});

describe("filterOptimizerHistoryByBot", () => {
  it("keeps only rows for requested bot and maps legacy rows to default bot", () => {
    const rows = [
      {
        jobId: "legacy-no-bot",
        mode: "single",
        historyType: "run",
        endedAtMs: 100,
        status: "done",
        runPayload: { datasetHistoryIds: [], candidates: 10, seed: 1, minTrades: 1, directionMode: "both", rememberNegatives: false, excludeNegative: false },
        summary: { bestNetPnl: 1, bestTrades: 1, bestWinRate: 10, bestProfitFactor: 1, bestMaxDD: 1, rowsPositive: 1, rowsTotal: 1 },
      },
      {
        jobId: "oi-bot",
        mode: "single",
        historyType: "run",
        endedAtMs: 200,
        status: "done",
        runPayload: { selectedBotId: "oi-momentum-v1", datasetHistoryIds: [], candidates: 10, seed: 1, minTrades: 1, directionMode: "both", rememberNegatives: false, excludeNegative: false },
        summary: { bestNetPnl: 1, bestTrades: 1, bestWinRate: 10, bestProfitFactor: 1, bestMaxDD: 1, rowsPositive: 1, rowsTotal: 1 },
      },
      {
        jobId: "signal-bot",
        mode: "single",
        historyType: "run",
        endedAtMs: 300,
        status: "done",
        runPayload: { selectedBotId: "signal-multi-factor-v1", datasetHistoryIds: [], candidates: 10, seed: 1, minTrades: 1, directionMode: "both", rememberNegatives: false, excludeNegative: false },
        summary: { bestNetPnl: 1, bestTrades: 1, bestWinRate: 10, bestProfitFactor: 1, bestMaxDD: 1, rowsPositive: 1, rowsTotal: 1 },
      },
    ] as any[];

    const oiRows = filterOptimizerHistoryByBot(rows, "oi-momentum-v1").map((row) => row.jobId);
    const signalRows = filterOptimizerHistoryByBot(rows, "signal-multi-factor-v1").map((row) => row.jobId);

    expect(oiRows).toEqual(["legacy-no-bot", "oi-bot"]);
    expect(signalRows).toEqual(["signal-bot"]);
  });
});
