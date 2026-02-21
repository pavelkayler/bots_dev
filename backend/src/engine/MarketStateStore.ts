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

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class MarketStateStore {
  private readonly bySymbol = new Map<string, MarketState>();
  private readonly lastUpdateTsBySymbol = new Map<string, number>();

  applyTickerPatch(symbol: string, patch: TickerPatch, ts: number = Date.now()): void {
    const prev = this.bySymbol.get(symbol) ?? { symbol };
    const next: MarketState = { ...prev, symbol };

    const assignIfDefined = (key: keyof TickerPatch, value: unknown) => {
      const parsed = toNumber(value);
      if (parsed !== undefined) {
        (next as TickerPatch)[key] = parsed;
      }
    };

    assignIfDefined('markPrice', patch.markPrice);
    assignIfDefined('openInterestValue', patch.openInterestValue);
    assignIfDefined('turnover24h', patch.turnover24h);
    assignIfDefined('highPrice24h', patch.highPrice24h);
    assignIfDefined('lowPrice24h', patch.lowPrice24h);
    assignIfDefined('fundingRate', patch.fundingRate);
    assignIfDefined('nextFundingTime', patch.nextFundingTime);

    this.bySymbol.set(symbol, next);
    this.lastUpdateTsBySymbol.set(symbol, ts);
  }

  get(symbol: string): MarketState | undefined {
    return this.bySymbol.get(symbol);
  }

  getLastUpdateTs(symbol: string): number | undefined {
    return this.lastUpdateTsBySymbol.get(symbol);
  }

  isDataStale(symbol: string, nowTs: number, staleMs = 5_000): boolean {
    const lastUpdateTs = this.lastUpdateTsBySymbol.get(symbol);
    if (lastUpdateTs === undefined) {
      return true;
    }
    return nowTs - lastUpdateTs > staleMs;
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
