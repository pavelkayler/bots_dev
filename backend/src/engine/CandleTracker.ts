import type { KlineCandle } from '../bybit';
import { MarketStateStore } from './MarketStateStore';
import type { CandleReference } from './types';

export class CandleTracker {
  private readonly refs = new Map<string, CandleReference>();

  constructor(private readonly marketStateStore: MarketStateStore) {}

  onKline(symbol: string, candle: KlineCandle): void {
    if (!candle.confirm) {
      return;
    }

    const market = this.marketStateStore.get(symbol);
    const prev = this.refs.get(symbol) ?? {};

    this.refs.set(symbol, {
      ...prev,
      prevCandleClose: candle.close,
      prevCandleOivUSDT: market?.openInterestValue,
      lastConfirmedTs: candle.timestamp,
    });
  }

  get(symbol: string): CandleReference | undefined {
    return this.refs.get(symbol);
  }

  reset(symbols: string[]): void {
    this.refs.clear();
    for (const symbol of symbols) {
      this.refs.set(symbol, {});
    }
  }
}
