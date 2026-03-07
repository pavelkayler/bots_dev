import { afterEach, describe, expect, it, vi } from "vitest";
import { Runtime } from "../runtime/runtime.js";

function createRuntimeWithLimits(overrides?: {
  maxTradesPerDay?: number;
  maxLossPerDayUsdt?: number | null;
  maxLossPerSessionUsdt?: number | null;
  maxConsecutiveErrors?: number;
}) {
  const runtime = new Runtime() as any;
  runtime.resetRiskState(Date.now());
  const limits = {
    maxTradesPerDay: 2,
    maxLossPerDayUsdt: null,
    maxLossPerSessionUsdt: null,
    maxConsecutiveErrors: 10,
    ...overrides,
  };
  runtime.getRiskLimits = () => limits;
  return runtime;
}

describe.sequential("runtime risk limits", () => {
  const runtimes: Runtime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      const rt = runtimes.pop();
      if (rt) await rt.stop();
    }
  });

  it("counts maxTradesPerDay from actual opens, not placements or fills", () => {
    const rt = createRuntimeWithLimits({ maxTradesPerDay: 1 });
    runtimes.push(rt);

    rt.handleRuntimeEvent({ ts: 1_000, type: "ORDER_PLACED", symbol: "BTCUSDT" });
    rt.handleRuntimeEvent({ ts: 1_100, type: "DEMO_ORDER_PLACE", symbol: "BTCUSDT" });
    expect(rt.riskEntriesPerDay).toBe(0);
    expect(rt.shouldAllowEntry("BTCUSDT", 1_200)).toBe(true);

    rt.handleRuntimeEvent({ ts: 1_300, type: "ORDER_FILLED", symbol: "BTCUSDT" });
    expect(rt.riskEntriesPerDay).toBe(0);
    expect(rt.shouldAllowEntry("BTCUSDT", 1_350)).toBe(true);

    rt.handleRuntimeEvent({ ts: 1_360, type: "POSITION_OPEN", symbol: "BTCUSDT" });
    expect(rt.riskEntriesPerDay).toBe(1);
    expect(rt.shouldAllowEntry("BTCUSDT", 1_400)).toBe(false);
  });

  it("does not consume daily budget for placed-only or canceled flows", () => {
    const rt = createRuntimeWithLimits({ maxTradesPerDay: 1 });
    runtimes.push(rt);

    rt.handleRuntimeEvent({ ts: 2_000, type: "ORDER_PLACED", symbol: "ETHUSDT" });
    rt.handleRuntimeEvent({ ts: 2_100, type: "ORDER_EXPIRED", symbol: "ETHUSDT" });
    rt.handleRuntimeEvent({ ts: 2_200, type: "ORDER_CANCELED", symbol: "ETHUSDT" });

    expect(rt.riskEntriesPerDay).toBe(0);
    expect(rt.shouldAllowEntry("ETHUSDT", 2_300)).toBe(true);
  });

  it("triggers emergency stop and runtime message on loss threshold breach", () => {
    const rt = createRuntimeWithLimits({ maxLossPerSessionUsdt: 1 });
    runtimes.push(rt);

    rt.handleRuntimeEvent({
      ts: 3_000,
      type: "DEMO_EXECUTION",
      symbol: "SOLUSDT",
      payload: { realizedPnl: -1.25 },
    });

    expect(rt.emergencyStopActive).toBe(true);
    expect(rt.runtimeMessage).toContain("Emergency stop:");
    expect(rt.runtimeMessage).toContain("maxLossPerSessionUsdt");
  });

  it("keeps emergency stop sticky until clean reset", () => {
    const rt = createRuntimeWithLimits();
    runtimes.push(rt);

    rt.handleRuntimeEvent({
      ts: 4_000,
      type: "DEMO_EXECUTION",
      symbol: "BTCUSDT",
      payload: { realizedPnl: -10 },
    });
    expect(rt.emergencyStopActive).toBe(false);

    rt.getRiskLimits = () => ({
      maxTradesPerDay: 2,
      maxLossPerDayUsdt: null,
      maxLossPerSessionUsdt: 1,
      maxConsecutiveErrors: 10,
    });
    rt.handleRuntimeEvent({
      ts: 4_100,
      type: "DEMO_EXECUTION",
      symbol: "BTCUSDT",
      payload: { realizedPnl: -1.1 },
    });
    expect(rt.emergencyStopActive).toBe(true);
    expect(rt.shouldAllowEntry("BTCUSDT", 4_200)).toBe(false);

    rt.resetRiskState(4_300);
    rt.runtimeMessage = null;
    expect(rt.emergencyStopActive).toBe(false);
    expect(rt.shouldAllowEntry("BTCUSDT", 4_400)).toBe(true);
  });

  it("triggers emergency stop on consecutive demo errors", () => {
    const rt = createRuntimeWithLimits({ maxConsecutiveErrors: 2 });
    runtimes.push(rt);

    rt.handleRuntimeEvent({ ts: 5_000, type: "DEMO_ORDER_ERROR", symbol: "BTCUSDT" });
    expect(rt.emergencyStopActive).toBe(false);
    rt.handleRuntimeEvent({ ts: 5_100, type: "DEMO_ORDER_ERROR", symbol: "BTCUSDT" });

    expect(rt.emergencyStopActive).toBe(true);
    expect(rt.runtimeMessage).toContain("maxConsecutiveErrors reached");
  });

  it("applies config for next trades only when session is active", () => {
    const stopped = new Runtime() as any;
    expect(stopped.applyConfigForNextTrades({ entryTimeoutSec: 120 }).applied).toBe(false);

    const rt = new Runtime() as any;
    const paperApply = vi.fn();
    const demoApply = vi.fn();
    rt.sessionState = "RUNNING";
    rt.paper = { applyConfigForNextTrades: paperApply };
    rt.demo = { applyConfigForNextTrades: demoApply };
    rt.logger = { log: vi.fn() };

    const result = rt.applyConfigForNextTrades({ entryTimeoutSec: 120, tpRoiPct: 10 });
    expect(result.applied).toBe(true);
    expect(paperApply).toHaveBeenCalled();
    expect(demoApply).toHaveBeenCalled();
    expect(String(rt.runtimeMessage)).toContain("next trades");
  });
});
