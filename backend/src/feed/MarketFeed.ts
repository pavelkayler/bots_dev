import type { BybitSubscriptions, KlineCandle, TickerPatch } from '../bybit/types';

export interface FeedSubscriptionReport {
  totalSymbols: number;
  connections: number;
  topicsPerConnection: number[];
}

export interface MarketFeed {
  setSubscriptions(subscriptions: BybitSubscriptions): void;
  start(): void;
  stop(): void;
  getSubscriptionReport(): FeedSubscriptionReport;
  on(event: string, listener: (...args: any[]) => void): void;
}

export interface MarketFeedCallbacks {
  onTickerPatch: (symbol: string, patch: TickerPatch) => void;
  onKline: (symbol: string, tfMin: number, candle: KlineCandle) => void;
  onError?: (error: Error) => void;
}
