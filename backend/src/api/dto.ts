import { z } from 'zod';

export type SessionState = 'STOPPED' | 'RUNNING' | 'COOLDOWN' | 'STOPPING';
export type SymbolStatus = 'IDLE' | 'ARMED' | 'ORDER_PLACED' | 'POSITION_OPEN';
export type OrderSide = 'BUY' | 'SELL';
export type EventType =
  | 'session_started'
  | 'universe_built'
  | 'error'
  | 'cooldown_entered'
  | 'cooldown_exited'
  | 'signal_fired'
  | 'order_placed'
  | 'order_filled'
  | 'order_expired'
  | 'order_canceled'
  | 'position_opened'
  | 'position_closed'
  | 'funding_applied'
  | 'session_stopped';

export const sessionStartRequestSchema = z.object({
  tfMin: z.number(),
  universe: z.object({
    minVolatility24hPct: z.number(),
    minTurnover24hUSDT: z.number(),
    maxSymbols: z.number(),
  }),
  signal: z.object({
    priceMovePctThreshold: z.number(),
    oivMovePctThreshold: z.number(),
  }),
  trade: z.object({
    marginUSDT: z.number(),
    leverage: z.number(),
    entryOffsetPct: z.number(),
    entryOrderTimeoutMin: z.number(),
    tpRoiPct: z.number(),
    slRoiPct: z.number(),
  }),
  fundingCooldown: z.object({
    beforeMin: z.number(),
    afterMin: z.number(),
  }),
  fees: z.object({
    makerRate: z.number(),
    takerRate: z.number(),
  }),
});

export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>;

export interface SessionStartResponse {
  ok: true;
  sessionId: string;
  state: 'RUNNING';
}

export interface SessionStopResponse {
  ok: true;
  sessionId: string | null;
  state: 'STOPPED';
}

export interface SessionStatusResponse {
  ok: true;
  sessionId: string | null;
  state: SessionState;
  tfMin: number;
  counts: Counts;
  cooldown: Cooldown;
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
    side: string;
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
  type: EventType;
  symbol: string;
  data: Record<string, unknown>;
}

export interface HelloMessage {
  type: 'hello';
  ts: number;
  protocolVersion: 1;
  server: { name: string; env: string };
}

export interface SnapshotMessage {
  type: 'snapshot';
  ts: number;
  session: { sessionId: string | null; state: SessionState; tfMin: number };
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
  session: { sessionId: string | null; state: SessionState };
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
