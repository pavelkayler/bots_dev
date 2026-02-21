import type { SessionStartRequest } from '../types/dto';

export type SignalSide = 'LONG' | 'SHORT';

export interface StrategyInput {
  symbol: string;
  markPrice?: number;
  oivUSDT?: number;
  fundingRate?: number;
  prevCandleClose?: number;
  prevCandleOivUSDT?: number;
  isArmed: boolean;
  dataReady: boolean;
  cooldownBlocked: boolean;
}

export interface SignalDecision {
  symbol: string;
  side: SignalSide;
  priceMovePct: number;
  oivMovePct: number;
}

export class StrategyEngine {
  evaluate(input: StrategyInput, config: SessionStartRequest): SignalDecision | null {
    if (!input.isArmed || !input.dataReady || input.cooldownBlocked) {
      return null;
    }

    if (
      input.markPrice === undefined ||
      input.oivUSDT === undefined ||
      input.fundingRate === undefined ||
      input.prevCandleClose === undefined ||
      input.prevCandleClose === 0 ||
      input.prevCandleOivUSDT === undefined ||
      input.prevCandleOivUSDT === 0
    ) {
      return null;
    }

    const priceMovePct = ((input.markPrice - input.prevCandleClose) / input.prevCandleClose) * 100;
    const oivMovePct = ((input.oivUSDT - input.prevCandleOivUSDT) / input.prevCandleOivUSDT) * 100;

    if (
      priceMovePct >= config.signal.priceMovePctThreshold &&
      oivMovePct >= config.signal.oivMovePctThreshold &&
      input.fundingRate > 0
    ) {
      return { symbol: input.symbol, side: 'LONG', priceMovePct, oivMovePct };
    }

    if (
      priceMovePct <= -config.signal.priceMovePctThreshold &&
      oivMovePct <= -config.signal.oivMovePctThreshold &&
      input.fundingRate < 0
    ) {
      return { symbol: input.symbol, side: 'SHORT', priceMovePct, oivMovePct };
    }

    return null;
  }
}
