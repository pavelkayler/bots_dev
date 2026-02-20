import type { TickerPatch } from '../bybit';
import type { MarketState } from './types';

const REQUIRED_CANONICAL_FIELDS: Array<keyof Omit<MarketState, 'symbol'>> = [
  'markPrice',
  'openInterestValue',
  'turnover24h',
  'highPrice24h',
  'lowPrice24h',
  'fundingRate',
  'nextFundingTime',
];

export class MarketStateStore {
  private readonly bySymbol = new Map<string, MarketState>();

  applyTickerPatch(symbol: string, patch: TickerPatch): void {
    const prev = this.bySymbol.get(symbol) ?? { symbol };
    this.bySymbol.set(symbol, {
      ...prev,
      ...patch,
      symbol,
    });
  }

  get(symbol: string): MarketState | undefined {
    return this.bySymbol.get(symbol);
  }

  hasFullCanonicalData(symbol: string): boolean {
    const row = this.bySymbol.get(symbol);
    if (!row) {
      return false;
    }
    return REQUIRED_CANONICAL_FIELDS.every((field) => row[field] !== undefined);
  }

  snapshot(symbols: string[]): Map<string, MarketState> {
    const out = new Map<string, MarketState>();
    for (const symbol of symbols) {
      const item = this.bySymbol.get(symbol);
      if (item) {
        out.set(symbol, { ...item });
      }
    }
    return out;
  }
}
