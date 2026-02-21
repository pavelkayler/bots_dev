import type { Cooldown } from '../types/dto';
import type { MarketState } from './types';

export interface FundingCooldownConfig {
  beforeMin: number;
  afterMin: number;
}

export class FundingCooldownGate {
  evaluate(symbols: string[], marketBySymbol: Map<string, MarketState>, config: FundingCooldownConfig, nowTs: number): Cooldown {
    let nextFundingTime: number | null = null;

    for (const symbol of symbols) {
      const ts = marketBySymbol.get(symbol)?.nextFundingTime;
      if (ts === undefined || ts <= nowTs) {
        continue;
      }
      if (nextFundingTime === null || ts < nextFundingTime) {
        nextFundingTime = ts;
      }
    }

    if (nextFundingTime === null) {
      return { isActive: false, reason: null, fromTs: null, untilTs: null };
    }

    const fromTs = nextFundingTime - config.beforeMin * 60_000;
    const untilTs = nextFundingTime + config.afterMin * 60_000;
    const isActive = nowTs >= fromTs && nowTs <= untilTs;

    return {
      isActive,
      reason: isActive ? 'FUNDING_WINDOW' : null,
      fromTs,
      untilTs,
    };
  }
}
