import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { BybitSubscriptions, KlineCandle, TickerPatch } from '../bybit/types';
import type { FeedSubscriptionReport, MarketFeed, MarketFeedCallbacks } from './MarketFeed';

interface SimFrame {
  t: number;
  tickers?: Record<string, TickerPatch>;
  klines?: Array<{ symbol: string; tfMin: number; candle: KlineCandle }>;
}

export interface SimScenario {
  name: string;
  baseTs: number;
  symbols: string[];
  frames: SimFrame[];
}

type Listener = (payload: unknown) => void;

export class SimFeed implements MarketFeed {
  private readonly listeners = new Map<string, Listener[]>();
  private readonly frameBySecond = new Map<number, SimFrame>();
  private subscriptions: BybitSubscriptions = { symbols: [], tfMin: 1, includeKline: true };
  private running = false;

  constructor(
    private readonly scenario: SimScenario,
    private readonly callbacks: MarketFeedCallbacks,
  ) {
    for (const frame of scenario.frames) {
      this.frameBySecond.set(frame.t, frame);
    }
  }

  static fromFile(filePath: string, callbacks: MarketFeedCallbacks): SimFeed {
    const fullPath = resolve(filePath);
    const scenario = JSON.parse(readFileSync(fullPath, 'utf8')) as SimScenario;
    return new SimFeed(scenario, callbacks);
  }

  setSubscriptions(subscriptions: BybitSubscriptions): void {
    this.subscriptions = {
      symbols: [...new Set(subscriptions.symbols)],
      tfMin: subscriptions.tfMin,
      includeKline: subscriptions.includeKline ?? true,
    };
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  on(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  getSubscriptionReport(): FeedSubscriptionReport {
    const topicsPerSymbol = this.subscriptions.includeKline ? 2 : 1;
    return {
      totalSymbols: this.subscriptions.symbols.length,
      connections: this.subscriptions.symbols.length > 0 ? 1 : 0,
      topicsPerConnection: this.subscriptions.symbols.length > 0 ? [this.subscriptions.symbols.length * topicsPerSymbol] : [],
    };
  }

  tick(secondOffset: number): void {
    if (!this.running) {
      return;
    }

    const frame = this.frameBySecond.get(secondOffset);
    if (!frame) {
      return;
    }

    const allowed = new Set(this.subscriptions.symbols);

    for (const [symbol, patch] of Object.entries(frame.tickers ?? {})) {
      if (allowed.size > 0 && !allowed.has(symbol)) {
        continue;
      }
      this.callbacks.onTickerPatch(symbol, patch);
      this.emit('ticker', { symbol, patch });
    }

    for (const item of frame.klines ?? []) {
      if (allowed.size > 0 && !allowed.has(item.symbol)) {
        continue;
      }
      if (item.tfMin !== this.subscriptions.tfMin) {
        continue;
      }
      this.callbacks.onKline(item.symbol, item.tfMin, item.candle);
      this.emit('kline', { symbol: item.symbol, tfMin: item.tfMin, candle: item.candle });
    }
  }

  private emit(event: string, payload: unknown): void {
    const list = this.listeners.get(event) ?? [];
    for (const listener of list) {
      listener(payload);
    }
  }
}
