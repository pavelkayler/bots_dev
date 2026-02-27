import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { configStore } from "./configStore.js";
import { EventLogger, type LogEvent } from "../logging/EventLogger.js";
import { PaperBroker, type PaperStats, type PaperView } from "../paper/PaperBroker.js";
import { DemoBroker, type DemoStats } from "../demo/DemoBroker.js";
import {
  computePaperSummaryFromEvents,
  getSummaryFilePathFromEventsFile,
  persistSummaryFile
} from "../paper/summary.js";

export type RuntimeSessionState = "STOPPED" | "RUNNING" | "STOPPING" | "PAUSING" | "PAUSED" | "RESUMING";

export type RuntimeBotStats = PaperStats & {
  executionMode: "paper" | "demo" | "empty";
  demoStats?: Omit<DemoStats, "mode">;
};

type Status = {
  sessionState: RuntimeSessionState;
  sessionId: string | null;
  eventsFile: string | null;
  summaryFile: string | null;
};


type ClosedTrade = {
  symbol: string;
  side: "LONG" | "SHORT";
  realizedPnl: number;
  feesPaid: number;
  fundingAccrued: number;
  closedAt: number;
  closeType: "TP" | "SL" | "FORCE";
  minRoiPct: number | null;
  maxRoiPct: number | null;
};

type TradeStatsBySymbolRow = {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  fees: number;
  funding: number;
  lastCloseTs: number | null;
  longTrades: number;
  longWins: number;
  shortTrades: number;
  shortWins: number;
};

type TradeExcursionsRow = {
  symbol: string;
  tpTrades: number;
  tpWorstMinRoiPct: number | null;
  slTrades: number;
  slBestMaxRoiPct: number | null;
};

function newSessionId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

class Runtime extends EventEmitter {
  private sessionState: RuntimeSessionState = "STOPPED";
  private sessionId: string | null = null;

  private logger: EventLogger | null = null;
  private paper: PaperBroker | null = null;
  private demo: DemoBroker | null = null;

  private summaryFilePath: string | null = null;
  private demoStartedAtMs: number | null = null;

  private getMarkPrice: ((symbol: string) => number | null) | null = null;
  private closedTrades: ClosedTrade[] = [];

  attachMarkPriceProvider(fn: (symbol: string) => number | null) {
    this.getMarkPrice = fn;
  }

  getStatus(): Status {
    return {
      sessionState: this.sessionState,
      sessionId: this.sessionId,
      eventsFile: this.logger?.filePath ?? null,
      summaryFile: this.summaryFilePath
    };
  }

  isRunning() {
    return this.sessionState === "RUNNING";
  }

  async start(): Promise<Status> {
    if (this.sessionState !== "STOPPED") {
      await this.stop();
    }

    this.sessionId = newSessionId();
    this.summaryFilePath = null;
    this.demoStartedAtMs = null;

    this.closedTrades = [];

    this.logger = new EventLogger(this.sessionId, (ev: LogEvent) => {
      const eventType = String(ev?.type ?? "");
      if (eventType === "POSITION_CLOSE_TP" || eventType === "POSITION_CLOSE_SL" || eventType === "POSITION_FORCE_CLOSE") {
        const payload = (ev?.payload ?? {}) as any;
        const side = String(payload.side ?? "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
        const closedAtRaw = Number(payload.closedAt ?? payload.closedTs ?? ev.ts ?? Date.now());
        const closedAt = Number.isFinite(closedAtRaw) ? closedAtRaw : Date.now();
        const minRoi = Number(payload.minRoiPct);
        const maxRoi = Number(payload.maxRoiPct);

        this.closedTrades.push({
          symbol: String(ev.symbol ?? "").trim(),
          side,
          realizedPnl: Number(payload.realizedPnl ?? 0) || 0,
          feesPaid: Number(payload.feesPaid ?? 0) || 0,
          fundingAccrued: Number(payload.fundingAccrued ?? 0) || 0,
          closedAt,
          closeType: eventType === "POSITION_CLOSE_TP" ? "TP" : eventType === "POSITION_CLOSE_SL" ? "SL" : "FORCE",
          minRoiPct: Number.isFinite(minRoi) ? minRoi : null,
          maxRoiPct: Number.isFinite(maxRoi) ? maxRoi : null,
        });
      }
      this.emit("event", ev);
    });

    const cfg = configStore.get();
    if (cfg.execution.mode === "demo") {
      this.paper = null;
      this.demo = new DemoBroker(cfg.paper, this.logger, this.getMarkPrice ?? undefined);
      this.demo.start();
    } else if (cfg.execution.mode === "empty") {
      this.paper = null;
      this.demo = null;
    } else {
      this.demo = null;
      this.paper = new PaperBroker(cfg.paper, this.logger);
    }

    this.sessionState = "RESUMING";
    this.logger?.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });
    this.emit("state", this.getStatus());

    this.sessionState = "RUNNING";
    if (cfg.execution.mode === "demo" && this.demo) {
      this.demoStartedAtMs = Date.now();
      this.demo.sessionStartBalanceUsdt = await this.demo.getWalletUsdtBalance();
    }

    this.logger.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });

    const status = this.getStatus();
    this.emit("state", status);
    return status;
  }

  async stop(): Promise<Status> {
    if (this.sessionState === "STOPPED") {
      const status = this.getStatus();
      this.emit("state", status);
      return status;
    }

    this.sessionState = "STOPPING";
    this.logger?.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });
    this.emit("state", this.getStatus());

    const now = Date.now();
    if (this.paper) {
      const provider = this.getMarkPrice ?? (() => null);
      this.paper.stopAll({
        nowMs: now,
        symbols: [],
        getMarkPrice: provider
      });
    }
    if (this.demo) {
      const demoEndedAtMs = Date.now();
      this.demo.sessionEndBalanceUsdt = await this.demo.getWalletUsdtBalance();
      const stats = this.demo.getStats();
      const startBalanceUsdt = this.demo.sessionStartBalanceUsdt;
      const endBalanceUsdt = this.demo.sessionEndBalanceUsdt;
      const deltaUsdt = startBalanceUsdt != null && endBalanceUsdt != null ? endBalanceUsdt - startBalanceUsdt : null;
      const demoSummary = {
        sessionId: this.sessionId,
        executionMode: "demo" as const,
        startedAtMs: this.demoStartedAtMs,
        endedAtMs: demoEndedAtMs,
        startBalanceUsdt,
        endBalanceUsdt,
        deltaUsdt,
        openPositionsAtEnd: stats.openPositions,
        openOrdersAtEnd: stats.openOrders,
        pendingEntriesAtEnd: stats.pendingEntries,
        tradesCount: stats.tradesCount,
        realizedPnlUsdt: stats.realizedPnlUsdt,
        feesUsdt: stats.feesUsdt,
        lastExecTimeMs: stats.lastExecTimeMs,
      };
      const sessionDir = this.logger?.filePath ? path.dirname(this.logger.filePath) : null;
      if (sessionDir) {
        fs.mkdirSync(sessionDir, { recursive: true });
        const outPath = path.join(sessionDir, "demo_summary.json");
        const tempPath = `${outPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(demoSummary, null, 2), "utf8");
        fs.renameSync(tempPath, outPath);
      }
      this.demo.stop();
      this.demo = null;
    }
    this.demoStartedAtMs = null;

    this.sessionState = "STOPPED";
    this.logger?.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });

    const eventsFile = this.logger?.filePath ?? null;
    if (eventsFile) {
      try {
        const outFile = getSummaryFilePathFromEventsFile(eventsFile);
        const data = computePaperSummaryFromEvents({ sessionId: this.sessionId, eventsFile });
        persistSummaryFile(outFile, data);
        this.summaryFilePath = outFile;
      } catch {
        this.summaryFilePath = null;
      }
    }

    const status = this.getStatus();
    this.emit("state", status);
    return status;
  }

  pause(): Status {
    if (this.sessionState !== "RUNNING") {
      const status = this.getStatus();
      this.emit("state", status);
      return status;
    }

    this.sessionState = "PAUSING";
    this.logger?.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });
    this.emit("state", this.getStatus());

    this.sessionState = "PAUSED";
    this.logger?.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });

    if (this.demo) this.demo.stop();

    const status = this.getStatus();
    this.emit("state", status);
    return status;
  }

  resume(): Status {
    if (this.sessionState !== "PAUSED") {
      const status = this.getStatus();
      this.emit("state", status);
      return status;
    }

    this.sessionState = "RUNNING";
    if (this.demo) this.demo.start();
    this.logger?.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });

    const status = this.getStatus();
    this.emit("state", status);
    return status;
  }


  getBotStats(): RuntimeBotStats {
    if (this.demo) {
      const demoStats = this.demo.getStats();
      return {
        openPositions: 0,
        pendingOrders: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        netRealized: 0,
        feesPaid: 0,
        fundingAccrued: 0,
        executionMode: "demo",
        demoStats: {
          openPositions: demoStats.openPositions,
          openOrders: demoStats.openOrders,
          globalOpenPositions: demoStats.globalOpenPositions,
          globalOpenOrders: demoStats.globalOpenOrders,
          trackedOpenPositions: demoStats.trackedOpenPositions,
          trackedOpenOrders: demoStats.trackedOpenOrders,
          pendingEntries: demoStats.pendingEntries,
          lastReconcileAtMs: demoStats.lastReconcileAtMs,
          tradesCount: demoStats.tradesCount,
          realizedPnlUsdt: demoStats.realizedPnlUsdt,
          feesUsdt: demoStats.feesUsdt,
          lastExecTimeMs: demoStats.lastExecTimeMs,
        },
      };
    }
    if (this.paper) return { ...this.paper.getStats(), executionMode: "paper" };
    const mode = configStore.get().execution.mode;
    return {
      openPositions: 0,
      pendingOrders: 0,
      closedTrades: 0,
      wins: 0,
      losses: 0,
      netRealized: 0,
      feesPaid: 0,
      fundingAccrued: 0,
      executionMode: mode,
    };
  }

  getPaperView(symbol: string, markPrice: number | null): PaperView {
    if (!this.paper || !this.isRunning()) {
      return {
        paperStatus: "IDLE",
        paperSide: null,
        paperEntryPrice: null,
        paperTpPrice: null,
        paperSlPrice: null,
        paperQty: null,
        paperOrderExpiresAt: null,
        paperUnrealizedPnl: null,
        paperRealizedPnl: 0
      };
    }
    return this.paper.getView(symbol, markPrice);
  }

  tickPaper(args: {
    symbol: string;
    nowMs: number;
    markPrice: number;
    fundingRate: number;
    nextFundingTime: number;
    signal: "LONG" | "SHORT" | null;
    signalReason: string;
    cooldownActive: boolean;
  }) {
    if (!this.isRunning()) return;
    const mode = configStore.get().execution.mode;
    if (mode === "empty") return;
    if (mode === "demo") {
      if (!this.demo) return;
      void this.demo.tick(args);
      return;
    }
    if (!this.paper) return;
    this.paper.tick(args);
  }

  getTradeStatsBySymbol(mode: "both" | "long" | "short", symbols: string[]): TradeStatsBySymbolRow[] {
    const rows = new Map<string, TradeStatsBySymbolRow>();
    for (const symbol of symbols) {
      rows.set(symbol, {
        symbol,
        trades: 0,
        wins: 0,
        losses: 0,
        netPnl: 0,
        fees: 0,
        funding: 0,
        lastCloseTs: null,
        longTrades: 0,
        longWins: 0,
        shortTrades: 0,
        shortWins: 0,
      });
    }

    for (const trade of this.closedTrades) {
      if (!rows.has(trade.symbol)) continue;
      if (mode === "long" && trade.side !== "LONG") continue;
      if (mode === "short" && trade.side !== "SHORT") continue;
      const row = rows.get(trade.symbol)!;
      row.trades += 1;
      if (trade.realizedPnl > 0) row.wins += 1;
      else row.losses += 1;
      row.netPnl += trade.realizedPnl;
      row.fees += trade.feesPaid;
      row.funding += trade.fundingAccrued;
      row.lastCloseTs = row.lastCloseTs == null ? trade.closedAt : Math.max(row.lastCloseTs, trade.closedAt);
      if (trade.side === "LONG") {
        row.longTrades += 1;
        if (trade.realizedPnl > 0) row.longWins += 1;
      } else {
        row.shortTrades += 1;
        if (trade.realizedPnl > 0) row.shortWins += 1;
      }
    }

    if (mode === "long") {
      for (const row of rows.values()) {
        row.shortTrades = 0;
        row.shortWins = 0;
      }
    }
    if (mode === "short") {
      for (const row of rows.values()) {
        row.longTrades = 0;
        row.longWins = 0;
      }
    }

    return symbols.map((symbol) => rows.get(symbol)!);
  }

  getTradeExcursionsBySymbol(symbols: string[]): TradeExcursionsRow[] {
    const rows = new Map<string, TradeExcursionsRow>();
    for (const symbol of symbols) {
      rows.set(symbol, {
        symbol,
        tpTrades: 0,
        tpWorstMinRoiPct: null,
        slTrades: 0,
        slBestMaxRoiPct: null,
      });
    }

    for (const trade of this.closedTrades) {
      if (!rows.has(trade.symbol)) continue;
      const row = rows.get(trade.symbol)!;
      if (trade.closeType === "TP") {
        row.tpTrades += 1;
        if (trade.minRoiPct != null) {
          row.tpWorstMinRoiPct = row.tpWorstMinRoiPct == null ? trade.minRoiPct : Math.min(row.tpWorstMinRoiPct, trade.minRoiPct);
        }
      }
      if (trade.closeType === "SL") {
        row.slTrades += 1;
        if (trade.maxRoiPct != null) {
          row.slBestMaxRoiPct = row.slBestMaxRoiPct == null ? trade.maxRoiPct : Math.max(row.slBestMaxRoiPct, trade.maxRoiPct);
        }
      }
    }

    return symbols.map((symbol) => rows.get(symbol)!);
  }

}

export const runtime = new Runtime();
