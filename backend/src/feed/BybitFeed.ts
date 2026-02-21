import { BybitWsClient } from '../bybit/BybitWsClient';
import type { BybitSubscriptions } from '../bybit/types';
import type { FeedSubscriptionReport, MarketFeed, MarketFeedCallbacks } from './MarketFeed';

export class BybitFeed implements MarketFeed {
  private readonly client: BybitWsClient;

  constructor(callbacks: MarketFeedCallbacks) {
    this.client = new BybitWsClient({
      onTicker: callbacks.onTickerPatch,
      onKline: callbacks.onKline,
      onError: callbacks.onError,
    });
  }

  setSubscriptions(subscriptions: BybitSubscriptions): void {
    this.client.setSubscriptions(subscriptions);
  }

  start(): void {
    this.client.start();
  }

  stop(): void {
    this.client.stop();
  }

  getSubscriptionReport(): FeedSubscriptionReport {
    return this.client.getSubscriptionReport();
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.client.on(event, listener);
  }
}
