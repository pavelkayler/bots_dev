import { EventEmitter } from "node:events";
import { configStore } from "./configStore.js";
import { EventLogger, type LogEvent } from "../logging/EventLogger.js";
import { PaperBroker, type PaperStats, type PaperView } from "../paper/PaperBroker.js";
import {
  computePaperSummaryFromEvents,
  getSummaryFilePathFromEventsFile,
  persistSummaryFile
} from "../paper/summary.js";

export type RuntimeSessionState = "STOPPED" | "RUNNING" | "STOPPING";

type Status = {
  sessionState: RuntimeSessionState;
  sessionId: string | null;
  eventsFile: string | null;
  summaryFile: string | null;
};

function newSessionId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

class Runtime extends EventEmitter {
  private sessionState: RuntimeSessionState = "STOPPED";
  private sessionId: string | null = null;

  private logger: EventLogger | null = null;
  private paper: PaperBroker | null = null;

  private summaryFilePath: string | null = null;

  private getMarkPrice: ((symbol: string) => number | null) | null = null;

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

  start(): Status {
    if (this.sessionState === "RUNNING") {
      this.stop();
    }

    this.sessionId = newSessionId();
    this.summaryFilePath = null;

    this.logger = new EventLogger(this.sessionId, (ev: LogEvent) => {
      this.emit("event", ev);
    });

    const cfg = configStore.get();
    this.paper = new PaperBroker(cfg.paper, this.logger);

    this.sessionState = "RUNNING";

    this.logger.log({
      ts: Date.now(),
      type: "SESSION_STATE",
      payload: { state: this.sessionState, sessionId: this.sessionId }
    });

    const status = this.getStatus();
    this.emit("state", status);
    return status;
  }

  stop(): Status {
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


  getBotStats(): PaperStats {
    if (!this.paper || !this.isRunning()) {
      return {
        openPositions: 0,
        pendingOrders: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        netRealized: 0,
        feesPaid: 0,
        fundingAccrued: 0
      };
    }
    return this.paper.getStats();
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
    if (!this.paper || !this.isRunning()) return;
    this.paper.tick(args);
  }
}

export const runtime = new Runtime();
