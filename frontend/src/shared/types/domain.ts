export type SessionState = "STOPPED" | "RUNNING" | "STOPPING" | "PAUSING" | "PAUSED" | "RESUMING";

export type ConnStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "RECONNECTING";

export type StatusResponse = {
  sessionState: SessionState;
  sessionId: string | null;
  eventsFile: string | null;
  runningSinceMs?: number | null;
  runtimeMessage?: string | null;
};

export type ProcessStatusResponse = {
  serverBootId?: string | null;
  runtime: {
    state: SessionState;
    runningSinceMs: number | null;
    message: string | null;
  };
  optimizer: {
    state: "running" | "paused" | "stopped";
    runIndex: number;
    runsCount: number;
    isInfinite: boolean;
    currentJobId: string | null;
    jobStatus: "running" | "paused" | "done" | "error" | "cancelled" | null;
    progressPct: number;
    message: string | null;
  };
  receiveData: {
    state: "idle" | "queued" | "running" | "done" | "error" | "cancelled";
    jobId: string | null;
    progressPct: number;
    currentSymbol: string | null;
    message: string | null;
    etaSec: number | null;
  };
  recorder: {
    state: "idle" | "running" | "waiting" | "error";
    mode: "off" | "record_only" | "record_while_running";
    progressPct: number | null;
    message: string | null;
    writes?: number;
    droppedBoundaryPoints?: number;
    trackedSymbols?: number;
    lastWriteAtMs?: number | null;
  };
};

export type RuntimeConfig = {
  selectedBotId?: string;
  selectedBotPresetId?: string;
  selectedExecutionProfileId?: string;
  universe: {
    selectedId?: string;
    symbols: string[];
    klineTfMin: number;
  };
  botConfig?: {
    fundingCooldown: {
      beforeMin: number;
      afterMin: number;
    };
    signals: {
      priceThresholdPct: number;
      oivThresholdPct: number;
      requireFundingSign: boolean;
      dailyTriggerMin: number;
      dailyTriggerMax: number;
    };
    strategy: {
      klineTfMin: number;
      entryOffsetPct: number;
      entryTimeoutSec: number;
      tpRoiPct: number;
      slRoiPct: number;
      rearmDelayMs: number;
      applyFunding: boolean;
    };
  };
  executionProfile?: {
    execution: {
      mode: "paper" | "demo" | "empty";
    };
    paper: {
      enabled: boolean;
      directionMode: "both" | "long" | "short";
      marginUSDT: number;
      leverage: number;
      makerFeeRate: number;
      maxDailyLossUSDT: number;
    };
    riskLimits: {
      maxTradesPerDay: number;
      maxLossPerDayUsdt: number | null;
      maxLossPerSessionUsdt: number | null;
      maxConsecutiveErrors: number;
    };
  };
  fundingCooldown: {
    beforeMin: number;
    afterMin: number;
  };
  signals: {
    priceThresholdPct: number;
    oivThresholdPct: number;
    requireFundingSign: boolean;
    dailyTriggerMin: number;
    dailyTriggerMax: number;
  };
  execution: {
    mode: "paper" | "demo" | "empty";
  };
  paper: {
    enabled: boolean;
    directionMode: "both" | "long" | "short";
    marginUSDT: number;
    leverage: number;

    entryOffsetPct: number;
    entryTimeoutSec: number;

    tpRoiPct: number;
    slRoiPct: number;

    makerFeeRate: number;
    applyFunding: boolean;

    rearmDelayMs: number;
    maxDailyLossUSDT: number;
  };
  riskLimits?: {
    maxTradesPerDay: number;
    maxLossPerDayUsdt: number | null;
    maxLossPerSessionUsdt: number | null;
    maxConsecutiveErrors: number;
  };
};

export type ConfigResponse = {
  config: RuntimeConfig;
  applied?: any;
};

export type StreamsState = {
  streamsEnabled: boolean;
  bybitConnected: boolean;
};

export type BotStats = {
  openPositions: number;
  pendingOrders: number;

  unrealizedPnl: number;

  closedTrades: number;
  wins: number;
  losses: number;

  netRealized: number;
  feesPaid: number;
  fundingAccrued: number;

  executionMode?: "paper" | "demo" | "empty";
  demoStats?: {
    openPositions: number;
    openOrders: number;
    globalOpenPositions: number;
    globalOpenOrders: number;
    trackedOpenPositions?: number;
    trackedOpenOrders?: number;
    pendingEntries: number;
    lastReconcileAtMs: number;
    tradesCount: number;
    realizedPnlUsdt: number;
    feesUsdt: number;
    lastExecTimeMs: number | null;
    startBalanceUsdt?: number | null;
    currentBalanceUsdt?: number | null;
    currentBalanceUpdatedAtMs?: number | null;
  };
};

export type DemoSummaryResponse = {
  sessionId: string | null;
  executionMode: "demo";
  startedAtMs: number | null;
  endedAtMs: number;
  startBalanceUsdt: number | null;
  endBalanceUsdt: number | null;
  deltaUsdt: number | null;
  openPositionsAtEnd: number;
  openOrdersAtEnd: number;
  pendingEntriesAtEnd: number;
  tradesCount?: number;
  realizedPnlUsdt?: number;
  feesUsdt?: number;
  lastExecTimeMs?: number | null;
};

export type SymbolRow = {
  symbol: string;
  markPrice: number;
  openInterestValue: number;
  fundingRate: number;
  nextFundingTime: number;
  fundingIntervalHour?: number | null;
  turnover24hUsd?: number | null;
  highPrice24h?: number | null;
  lowPrice24h?: number | null;
  updatedAt: number;

  prevCandleClose?: number | null;
  prevCandleOivClose?: number | null;
  candleConfirmedAt?: number | null;

  priceMovePct?: number | null;
  oivMovePct?: number | null;

  cooldownActive?: boolean;
  cooldownWindowStartMs?: number | null;
  cooldownWindowEndMs?: number | null;

  signal?: "LONG" | "SHORT" | null;
  signalReason?: string;

  paperStatus?: "IDLE" | "ENTRY_PENDING" | "OPEN";
  paperSide?: "LONG" | "SHORT" | null;
  paperEntryPrice?: number | null;
  paperTpPrice?: number | null;
  paperSlPrice?: number | null;
  paperQty?: number | null;
  paperOrderExpiresAt?: number | null;
  paperUnrealizedPnl?: number | null;
  paperRealizedPnl?: number;
};

export type OptimizerWsSnapshot = {
  jobId: string | null;
  rows: any[];
};

export type LogEvent = {
  ts?: number;
  type?: string;
  symbol?: string;
  payload?: any;
  [k: string]: any;
};

export type WsMessage =
  | { type: "hello"; serverTime: number }
  | { type: "snapshot"; payload: { sessionState: SessionState; sessionId: string | null; runningSinceMs?: number | null; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number; optimizer?: OptimizerWsSnapshot } & StreamsState }
  | { type: "tick"; payload: { serverTime: number; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number } }
  | { type: "streams_state"; payload: StreamsState }
  | { type: "events_tail"; payload: { limit: number; count: number; events: LogEvent[] } }
  | { type: "events_append"; payload: { event: LogEvent } }
  | { type: "optimizer_rows_append"; payload: { jobId: string; rows: any[] } }
  | { type: "error"; message: string };

export type EventsTailResponse = { limit: number; count: number; events: LogEvent[] };
