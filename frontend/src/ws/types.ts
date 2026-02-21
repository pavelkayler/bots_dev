export type SessionState = 'STOPPED' | 'RUNNING' | 'COOLDOWN' | 'STOPPING';
export type SymbolStatus = 'IDLE' | 'ARMED' | 'ORDER_PLACED' | 'POSITION_OPEN';
export type OrderSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT';

export interface SessionStartRequest {
  tfMin: 1 | 3 | 5 | 10 | 15;
  universe: {
    minVolatility24hPct: number;
    minTurnover24hUSDT: number;
    maxSymbols: number;
  };
  signal: {
    priceMovePctThreshold: number;
    oivMovePctThreshold: number;
  };
  trade: {
    marginUSDT: number;
    leverage: number;
    entryOffsetPct: number;
    entryOrderTimeoutMin: number;
    tpRoiPct: number;
    slRoiPct: number;
  };
  fundingCooldown: {
    beforeMin: number;
    afterMin: number;
  };
  fees: {
    makerRate: number;
    takerRate: number;
  };
}

export interface Counts {
  symbolsTotal: number;
  ordersActive: number;
  positionsOpen: number;
}

export interface Cooldown {
  isActive: boolean;
  reason: string | null;
  fromTs: number | null;
  untilTs: number | null;
}

export interface SymbolRow {
  symbol: string;
  status: SymbolStatus;
  market: {
    markPrice: number;
    turnover24hUSDT: number;
    volatility24hPct: number;
    oivUSDT: number;
  };
  funding: {
    rate: number;
    nextFundingTimeTs: number;
    nextFundingTimeMsk: string;
    countdownSec: number;
  };
  signalMetrics: {
    prevCandleClose: number;
    prevCandleOivUSDT: number;
    priceMovePct: number;
    oivMovePct: number;
  };
  order: {
    side: OrderSide;
    type: string;
    status: string;
    placedTs: number;
    expiresTs: number;
    price: number;
    qty: number;
  } | null;
  position: {
    side: PositionSide;
    entryTs: number;
    entryPrice: number;
    qty: number;
    tpPrice: number;
    slPrice: number;
    fundingAccruedUSDT: number;
    feesPaidUSDT: number;
    unrealizedPnlUSDT: number;
    unrealizedRoiPct: number;
  } | null;
  gates: {
    cooldownBlocked: boolean;
    dataReady: boolean;
  };
}

export interface EventRow {
  id: string;
  ts: number;
  type: string;
  symbol: string;
  data: Record<string, unknown>;
}

export interface SessionStartResponse {
  ok: true;
  sessionId: string;
  state: SessionState;
}

export interface SessionStopResponse {
  ok: true;
  sessionId: string | null;
  state: SessionState;
}

export interface SessionStatusResponse {
  ok: true;
  sessionId: string | null;
  state: SessionState;
  tfMin: number;
  counts: Counts;
  cooldown: Cooldown;
}

export interface HelloMessage {
  type: 'hello';
  ts: number;
  protocolVersion: 1;
  server: {
    name: string;
    env: string;
  };
}

export interface SnapshotMessage {
  type: 'snapshot';
  ts: number;
  session: {
    sessionId: string | null;
    state: SessionState;
    tfMin: number;
  };
  config: SessionStartRequest | null;
  counts: Counts;
  cooldown: Cooldown;
  universe: string[];
  symbols: SymbolRow[];
  eventsTail: EventRow[];
}

export interface TickMessage {
  type: 'tick';
  ts: number;
  session: {
    sessionId: string | null;
    state: SessionState;
  };
  counts: Counts;
  cooldown: Cooldown;
  symbolsDelta: SymbolRow[];
}

export interface EventsAppendMessage {
  type: 'events_append';
  ts: number;
  sessionId: string | null;
  events: EventRow[];
}

export interface SessionStateMessage {
  type: 'session_state';
  ts: number;
  sessionId: string | null;
  state: SessionState;
  cooldown: Cooldown;
}

export interface ErrorMessage {
  type: 'error';
  ts: number;
  sessionId: string | null;
  scope: string;
  code: string;
  message: string;
  data: Record<string, unknown>;
}

export type WsIncomingMessage =
  | HelloMessage
  | SnapshotMessage
  | TickMessage
  | EventsAppendMessage
  | SessionStateMessage
  | ErrorMessage;
