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
  runningSinceMs: number | null;
};

type StartOptions = {
  waitForReady?: (ctx: { runId: string; signal: AbortSignal }) => Promise<void>;
};

type RunContext = {
  runId: string;
  abortController: AbortController;
  startedAt: number;
  stopRequestedAt: number | null;
};

const STARTUP_OPERATION_TIMEOUT_MS = 5_000;
const STOP_OPERATION_TIMEOUT_MS = 5_000;
const STOP_OVERALL_TIMEOUT_MS = 15_000;


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
  private runningSinceMs: number | null = null;

  private getMarkPrice: ((symbol: string) => number | null) | null = null;
  private closedTrades: ClosedTrade[] = [];
  private runContext: RunContext | null = null;
  private stopPromise: Promise<Status> | null = null;

  private transitionState(nextState: RuntimeSessionState) {
    const fromState = this.sessionState;
    this.sessionState = nextState;
    const runId = this.runContext?.runId ?? this.sessionId;
    this.logger?.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: nextState, fromState, runId, sessionId: this.sessionId }
    });
  }

  private async withAbortAndTimeout<T>(promise: Promise<T>, args: { signal: AbortSignal; timeoutMs: number; label: string }): Promise<T> {
    const { signal, timeoutMs, label } = args;
    if (signal.aborted) throw new Error(`aborted:${label}`);
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout:${label}`));
      }, timeoutMs);
      const onAbort = () => {
        cleanup();
        reject(new Error(`aborted:${label}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then((value) => {
        cleanup();
        resolve(value);
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  attachMarkPriceProvider(fn: (symbol: string) => number | null) {
    this.getMarkPrice = fn;
  }

  getStatus(): Status {
    return {
      sessionState: this.sessionState,
      sessionId: this.sessionId,
      eventsFile: this.logger?.filePath ?? null,
      summaryFile: this.summaryFilePath,
      runningSinceMs: this.runningSinceMs,
    };
  }

  isRunning() {
    return this.sessionState === "RUNNING";
  }

  async start(opts?: StartOptions): Promise<Status> {
    if (this.sessionState !== "STOPPED") {
      await this.stop();
    }

    this.sessionId = newSessionId();
    const runId = this.sessionId;
    const abortController = new AbortController();
    this.runContext = {
      runId,
      abortController,
      startedAt: Date.now(),
      stopRequestedAt: null,
    };
    this.summaryFilePath = null;
    this.demoStartedAtMs = null;
    this.runningSinceMs = null;

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
      this.demo = new DemoBroker(cfg.paper, this.logger, this.sessionId ?? "run", this.getMarkPrice ?? undefined);
      this.demo.start();
    } else if (cfg.execution.mode === "empty") {
      this.paper = null;
      this.demo = null;
    } else {
      this.demo = null;
      this.paper = new PaperBroker(cfg.paper, this.logger, this.sessionId ?? "run");
    }

    this.transitionState("RESUMING");
    this.emit("state", this.getStatus());

    try {
      await opts?.waitForReady?.({ runId, signal: abortController.signal });
    } catch {
      if (this.demo) {
        this.demo.stop();
      }
      this.paper = null;
      this.demo = null;
      this.demoStartedAtMs = null;
      this.runningSinceMs = null;
      this.runContext = null;
      this.sessionState = "STOPPED";
      const status = this.getStatus();
      this.emit("state", status);
      return status;
    }

    if (abortController.signal.aborted || this.runContext?.runId !== runId) {
      this.transitionState("STOPPED");
      this.runContext = null;
      const status = this.getStatus();
      this.emit("state", status);
      return status;
    }

    this.transitionState("RUNNING");
    this.runningSinceMs = Date.now();
    if (cfg.execution.mode === "demo" && this.demo) {
      this.demoStartedAtMs = this.runningSinceMs;
      this.demo.sessionStartBalanceUsdt = await this.withAbortAndTimeout(this.demo.getWalletUsdtBalance(), {
        signal: abortController.signal,
        timeoutMs: STARTUP_OPERATION_TIMEOUT_MS,
        label: "demo_session_start_balance",
      });
    }

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

    if (this.stopPromise) return this.stopPromise;

    const stopStartedAt = Date.now();
    this.stopPromise = (async () => {
      if (this.sessionState !== "STOPPING") {
        this.transitionState("STOPPING");
        this.emit("state", this.getStatus());
      }

      const runCtx = this.runContext;
      if (runCtx) {
        runCtx.stopRequestedAt = Date.now();
        runCtx.abortController.abort();
      }

      const stopSignal = runCtx?.abortController.signal ?? new AbortController().signal;

      try {
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
          let endBalanceUsdt: number | null = null;
          try {
            endBalanceUsdt = await this.withAbortAndTimeout(this.demo.getWalletUsdtBalance(), {
              signal: stopSignal,
              timeoutMs: STOP_OPERATION_TIMEOUT_MS,
              label: "demo_session_end_balance",
            });
          } catch {
            endBalanceUsdt = null;
          }
          this.demo.sessionEndBalanceUsdt = endBalanceUsdt;
          const stats = this.demo.getStats();
          const startBalanceUsdt = this.demo.sessionStartBalanceUsdt;
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
      } finally {
        this.paper = null;
        this.demoStartedAtMs = null;
        this.runningSinceMs = null;
        this.runContext = null;

        this.transitionState("STOPPED");

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

        const stopDurationMs = Date.now() - stopStartedAt;
        this.logger?.log({ ts: Date.now(), type: "SESSION_STOP", payload: { sessionId: this.sessionId, stopDurationMs } });
      }

      const status = this.getStatus();
      this.emit("state", status);
      return status;
    })();

    const timeoutPromise = new Promise<Status>((resolve) => {
      setTimeout(() => {
        if (this.sessionState !== "STOPPED") {
          this.paper = null;
          this.demo = null;
          this.demoStartedAtMs = null;
          this.runningSinceMs = null;
          this.runContext = null;
          this.transitionState("STOPPED");
          const status = this.getStatus();
          this.emit("state", status);
          resolve(status);
        }
      }, STOP_OVERALL_TIMEOUT_MS);
    });

    try {
      return await Promise.race([this.stopPromise, timeoutPromise]);
    } finally {
      this.stopPromise = null;
    }
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

    this.transitionState("RUNNING");
    if (this.runningSinceMs == null) this.runningSinceMs = Date.now();
    if (this.demo) this.demo.start();

    const status = this.getStatus();
    this.emit("state", status);
    return status;
  }


  getBotStats(): RuntimeBotStats {
    if (this.demo) {
      const demoStats = this.demo.getStats();
      const balanceSnapshot = this.demo.getCurrentBalance();
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
          startBalanceUsdt: this.demo.sessionStartBalanceUsdt,
          currentBalanceUsdt: balanceSnapshot.currentBalanceUsdt,
          currentBalanceUpdatedAtMs: balanceSnapshot.currentBalanceUpdatedAtMs,
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
