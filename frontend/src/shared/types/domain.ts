export type SessionState = "STOPPED" | "RUNNING" | "STOPPING" | "PAUSING" | "PAUSED" | "RESUMING";

export type ConnStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "RECONNECTING";

export type StatusResponse = {
  sessionState: SessionState;
  sessionId: string | null;
  eventsFile: string | null;
};

export type RuntimeConfig = {
  universe: {
    selectedId?: string;
    symbols: string[];
    klineTfMin: number;
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
    mode: "paper" | "demo";
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

export type LogEvent = {
  ts?: number;
  type?: string;
  symbol?: string;
  payload?: any;
  [k: string]: any;
};

export type WsMessage =
  | { type: "hello"; serverTime: number }
  | { type: "snapshot"; payload: { sessionState: SessionState; sessionId: string | null; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number } & StreamsState }
  | { type: "tick"; payload: { serverTime: number; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number } }
  | { type: "streams_state"; payload: StreamsState }
  | { type: "events_tail"; payload: { limit: number; count: number; events: LogEvent[] } }
  | { type: "events_append"; payload: { event: LogEvent } }
  | { type: "error"; message: string };

export type EventsTailResponse = { limit: number; count: number; events: LogEvent[] };
