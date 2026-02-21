import type { OrderSide } from '../types/dto';

export type PositionSide = 'LONG' | 'SHORT';

export interface InternalOrder {
  side: OrderSide;
  type: 'LIMIT';
  status: 'OPEN';
  placedTs: number;
  expiresTs: number;
  price: number;
  qty: number;
}

export interface InternalPosition {
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
  lastFundingTsApplied: number | null;
}

export interface SymbolTradeState {
  order: InternalOrder | null;
  position: InternalPosition | null;
  rearmAtTs: number | null;
}

export interface MarketTick {
  markPrice?: number;
  fundingRate?: number;
  nextFundingTimeTs?: number;
}
