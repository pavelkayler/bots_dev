import { describe, expect, it } from "vitest";
import { PaperBroker, type PaperBrokerConfig } from "../paper/PaperBroker.js";

type LoggedEvent = { ts: number; type: string; symbol?: string; payload?: any };

function createHarness(overrides?: Partial<PaperBrokerConfig>) {
  const events: LoggedEvent[] = [];
  const cfg: PaperBrokerConfig = {
    enabled: true,
    directionMode: "both",
    marginUSDT: 100,
    leverage: 10,
    entryOffsetPct: 0,
    entryTimeoutSec: 5,
    tpRoiPct: 20,
    slRoiPct: 10,
    makerFeeRate: 0.001,
    applyFunding: false,
    rearmDelayMs: 0,
    maxDailyLossUSDT: 0,
    ...overrides,
  };
  const broker = new PaperBroker(cfg, { log: (ev: LoggedEvent) => events.push(ev) } as any);
  return { broker, events, cfg };
}

function tick(broker: PaperBroker, args: Partial<Parameters<PaperBroker["tick"]>[0]> & { nowMs: number; markPrice: number }) {
  broker.tick({
    symbol: "BTCUSDT",
    fundingRate: 0,
    nextFundingTime: Number.MAX_SAFE_INTEGER,
    signal: null,
    signalReason: "test",
    cooldownActive: false,
    ...args,
  });
}

describe("PaperBroker", () => {
  it("computes qty from margin * leverage / entryPrice", () => {
    const { broker, events, cfg } = createHarness();
    tick(broker, { nowMs: 1_000, markPrice: 200, signal: "LONG" });
    const placed = events.find((ev) => ev.type === "ORDER_PLACED");
    expect(placed).toBeTruthy();
    const qty = placed?.payload?.qty as number;
    expect(qty).toBeCloseTo((cfg.marginUSDT * cfg.leverage) / 200, 8);
  });

  it("fills long and short entries only when mark crosses entry condition", () => {
    const long = createHarness();
    tick(long.broker, { nowMs: 1_000, markPrice: 100, signal: "LONG" });
    tick(long.broker, { nowMs: 1_100, markPrice: 101 });
    expect(long.events.some((ev) => ev.type === "ORDER_FILLED")).toBe(false);
    tick(long.broker, { nowMs: 1_200, markPrice: 99.9 });
    expect(long.events.some((ev) => ev.type === "ORDER_FILLED")).toBe(true);

    const short = createHarness();
    tick(short.broker, { nowMs: 1_000, markPrice: 100, signal: "SHORT" });
    tick(short.broker, { nowMs: 1_100, markPrice: 99 });
    expect(short.events.some((ev) => ev.type === "ORDER_FILLED")).toBe(false);
    tick(short.broker, { nowMs: 1_200, markPrice: 100.1 });
    expect(short.events.some((ev) => ev.type === "ORDER_FILLED")).toBe(true);
  });

  it("derives TP/SL prices from ROI and leverage", () => {
    const { broker, events } = createHarness({ tpRoiPct: 20, slRoiPct: 10, leverage: 10 });
    tick(broker, { nowMs: 1_000, markPrice: 100, signal: "LONG" });
    tick(broker, { nowMs: 1_050, markPrice: 100 });
    const opened = events.find((ev) => ev.type === "POSITION_OPEN");
    expect(opened?.payload?.tpPrice).toBeCloseTo(102, 8);
    expect(opened?.payload?.slPrice).toBeCloseTo(99, 8);
  });

  it("emits TP/SL close events and realized pnl sign is direction-correct", () => {
    const long = createHarness({ makerFeeRate: 0 });
    tick(long.broker, { nowMs: 1_000, markPrice: 100, signal: "LONG" });
    tick(long.broker, { nowMs: 1_100, markPrice: 100 });
    tick(long.broker, { nowMs: 1_200, markPrice: 103 });
    const closeTp = long.events.find((ev) => ev.type === "POSITION_CLOSE_TP");
    expect(closeTp).toBeTruthy();
    expect(closeTp?.payload?.realizedPnl).toBeGreaterThan(0);

    const short = createHarness({ makerFeeRate: 0 });
    tick(short.broker, { nowMs: 1_000, markPrice: 100, signal: "SHORT" });
    tick(short.broker, { nowMs: 1_100, markPrice: 100 });
    tick(short.broker, { nowMs: 1_200, markPrice: 101.5 });
    const closeSl = short.events.find((ev) => ev.type === "POSITION_CLOSE_SL");
    expect(closeSl).toBeTruthy();
    expect(closeSl?.payload?.realizedPnl).toBeLessThan(0);
  });

  it("applies maker fees on entry and exit", () => {
    const { broker, events, cfg } = createHarness({ makerFeeRate: 0.001 });
    tick(broker, { nowMs: 1_000, markPrice: 100, signal: "LONG" });
    tick(broker, { nowMs: 1_100, markPrice: 100 });
    tick(broker, { nowMs: 1_200, markPrice: 103 });
    const close = events.find((ev) => ev.type === "POSITION_CLOSE_TP");
    const qty = (cfg.marginUSDT * cfg.leverage) / 100;
    const entryFee = 100 * qty * cfg.makerFeeRate;
    const exitFee = 102 * qty * cfg.makerFeeRate;
    const pnlFromMove = (102 - 100) * qty;
    expect(close?.payload?.feesPaid).toBeCloseTo(entryFee + exitFee, 8);
    expect(close?.payload?.realizedPnl).toBeCloseTo(pnlFromMove - entryFee - exitFee, 8);
  });

  it("expires entry orders after timeout without opening a position", () => {
    const { broker, events } = createHarness({ entryTimeoutSec: 1 });
    tick(broker, { nowMs: 1_000, markPrice: 100, signal: "LONG" });
    tick(broker, { nowMs: 2_100, markPrice: 99 });
    expect(events.some((ev) => ev.type === "ORDER_EXPIRED")).toBe(true);
    expect(events.some((ev) => ev.type === "POSITION_OPEN")).toBe(false);
  });

  it("respects rearm delay before allowing next order", () => {
    const { broker, events } = createHarness({ entryTimeoutSec: 1, rearmDelayMs: 5000 });
    tick(broker, { nowMs: 1_000, markPrice: 100, signal: "LONG" });
    tick(broker, { nowMs: 2_100, markPrice: 101 });
    tick(broker, { nowMs: 2_200, markPrice: 100, signal: "LONG" });
    const placedCountBefore = events.filter((ev) => ev.type === "ORDER_PLACED").length;
    tick(broker, { nowMs: 7_200, markPrice: 100, signal: "LONG" });
    const placedCountAfter = events.filter((ev) => ev.type === "ORDER_PLACED").length;
    expect(placedCountBefore).toBe(1);
    expect(placedCountAfter).toBe(2);
  });

  it("stopAll(closeOpenPositions:false) clears state without counting closed trades", () => {
    const { broker } = createHarness();
    tick(broker, { nowMs: 1_000, markPrice: 100, signal: "LONG" });
    tick(broker, { nowMs: 1_100, markPrice: 100 });

    broker.stopAll({
      nowMs: 2_000,
      symbols: ["BTCUSDT"],
      closeOpenPositions: false,
      getMarkPrice: () => 100,
    });

    const stats = broker.getStats();
    const view = broker.getView("BTCUSDT", 100);
    expect(stats.closedTrades).toBe(0);
    expect(stats.openPositions).toBe(0);
    expect(stats.pendingOrders).toBe(0);
    expect(view.paperStatus).toBe("IDLE");
  });
});
