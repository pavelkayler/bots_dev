import WebSocket from 'ws';
import { buildTopicsWithOptions, partitionTopicsByArgsLength } from './topicBuilder';
import {
  BYBIT_PUBLIC_LINEAR_WS_URL,
  BYBIT_WS_ARGS_MAX_CHARS,
  BYBIT_WS_PING_INTERVAL_MS,
  BYBIT_WS_RECONNECT_BASE_MS,
  BYBIT_WS_RECONNECT_MAX_MS,
  type BybitKlineRaw,
  type BybitSubscriptions,
  type BybitTickerRaw,
  type BybitTopicMessage,
  type BybitWsClientOptions,
  type KlineCandle,
  type TickerPatch,
} from './types';

type Shard = {
  id: number;
  topics: string[];
  ws?: WebSocket;
  reconnectTimeout?: ReturnType<typeof setTimeout>;
  pingInterval?: ReturnType<typeof setInterval>;
  reconnectAttempts: number;
};

type Listener = (...args: any[]) => void;

class SimpleEmitter {
  private listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  emit(event: string, ...args: unknown[]): void {
    const list = this.listeners.get(event) ?? [];
    for (const listener of list) {
      listener(...args);
    }
  }
}

type BybitPublicControlMessage = {
  op?: string;
  type?: string;
};

function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** Math.max(attempt - 1, 0), maxMs);
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSymbolFromTopic(topic: string): string | undefined {
  const parts = topic.split('.');
  return parts.at(-1);
}

function parseTickerMessage(input: unknown): { symbol: string; patch: TickerPatch } | undefined {
  const msg = input as BybitTopicMessage<BybitTickerRaw>;
  if (!msg.topic?.startsWith('tickers.')) {
    return undefined;
  }

  const symbol = msg.data?.symbol || parseSymbolFromTopic(msg.topic);
  if (!symbol) {
    return undefined;
  }

  return {
    symbol,
    patch: {
      markPrice: toNumber(msg.data?.markPrice),
      openInterestValue: toNumber(msg.data?.openInterestValue),
      turnover24h: toNumber(msg.data?.turnover24h),
      highPrice24h: toNumber(msg.data?.highPrice24h),
      lowPrice24h: toNumber(msg.data?.lowPrice24h),
      fundingRate: toNumber(msg.data?.fundingRate),
      nextFundingTime: toNumber(msg.data?.nextFundingTime),
    },
  };
}

function parseKlineMessage(
  input: unknown,
): { symbol: string; tfMin: number; candle: KlineCandle }[] | undefined {
  const msg = input as BybitTopicMessage<BybitKlineRaw[]>;
  if (!msg.topic?.startsWith('kline.')) {
    return undefined;
  }

  const [, tfStr, symbol] = msg.topic.split('.');
  const tfMin = Number(tfStr);
  if (!symbol || !Number.isFinite(tfMin)) {
    return undefined;
  }

  const rows = Array.isArray(msg.data) ? msg.data : [];
  const out: Array<{ symbol: string; tfMin: number; candle: KlineCandle }> = [];

  for (const row of rows) {
    const start = toNumber(row.start);
    const end = toNumber(row.end);
    const open = toNumber(row.open);
    const high = toNumber(row.high);
    const low = toNumber(row.low);
    const close = toNumber(row.close);
    const timestamp = toNumber(row.timestamp);

    if (
      start === undefined ||
      end === undefined ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      timestamp === undefined
    ) {
      continue;
    }

    out.push({
      symbol,
      tfMin,
      candle: {
        start,
        end,
        open,
        high,
        low,
        close,
        volume: toNumber(row.volume),
        turnover: toNumber(row.turnover),
        confirm: Boolean(row.confirm),
        timestamp,
      },
    });
  }

  return out;
}

export class BybitWsClient extends SimpleEmitter {
  private readonly options: Required<
    Pick<
      BybitWsClientOptions,
      'wsUrl' | 'pingIntervalMs' | 'argsMaxChars' | 'reconnectBaseMs' | 'reconnectMaxMs'
    >
  >;

  private readonly onTickerCb?: BybitWsClientOptions['onTicker'];
  private readonly onKlineCb?: BybitWsClientOptions['onKline'];
  private readonly onErrorCb?: BybitWsClientOptions['onError'];

  private running = false;
  private subscriptions: BybitSubscriptions = { symbols: [], tfMin: 1, includeKline: true };
  private topicGroups: string[][] = [];
  private shards: Shard[] = [];

  private readonly tickerState = new Map<string, TickerPatch>();

  constructor(opts: BybitWsClientOptions = {}) {
    super();
    this.options = {
      wsUrl: opts.wsUrl ?? BYBIT_PUBLIC_LINEAR_WS_URL,
      pingIntervalMs: opts.pingIntervalMs ?? BYBIT_WS_PING_INTERVAL_MS,
      argsMaxChars: opts.argsMaxChars ?? BYBIT_WS_ARGS_MAX_CHARS,
      reconnectBaseMs: opts.reconnectBaseMs ?? BYBIT_WS_RECONNECT_BASE_MS,
      reconnectMaxMs: opts.reconnectMaxMs ?? BYBIT_WS_RECONNECT_MAX_MS,
    };
    this.onTickerCb = opts.onTicker;
    this.onKlineCb = opts.onKline;
    this.onErrorCb = opts.onError;
  }

  setSubscriptions(subscriptions: BybitSubscriptions): void {
    this.subscriptions = {
      symbols: [...new Set(subscriptions.symbols)],
      tfMin: subscriptions.tfMin,
      includeKline: subscriptions.includeKline ?? true,
    };
    const topics = buildTopicsWithOptions(this.subscriptions.symbols, this.subscriptions.tfMin, {
      includeKline: this.subscriptions.includeKline ?? true,
    });
    this.topicGroups = partitionTopicsByArgsLength(topics, this.options.argsMaxChars);
    if (this.running) {
      this.recreateShards();
    }
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.recreateShards();
  }

  stop(): void {
    this.running = false;
    for (const shard of this.shards) {
      this.teardownShard(shard);
    }
    this.shards = [];
  }

  getTickerSnapshot(symbol: string): TickerPatch | undefined {
    return this.tickerState.get(symbol);
  }

  private recreateShards(): void {
    for (const shard of this.shards) {
      this.teardownShard(shard);
    }

    this.shards = this.topicGroups.map((topics, id) => ({
      id,
      topics,
      reconnectAttempts: 0,
    }));

    for (const shard of this.shards) {
      this.connectShard(shard);
    }
  }

  private connectShard(shard: Shard): void {
    if (!this.running) {
      return;
    }

    const ws = new WebSocket(this.options.wsUrl);
    shard.ws = ws;

    ws.on('open', () => {
      shard.reconnectAttempts = 0;
      this.sendSubscribe(shard);
      this.setupHeartbeat(shard);
      this.emit('connected', shard.id);
    });

    ws.on('message', (raw: unknown) => {
      const payload = typeof raw === 'string' ? raw : (raw as { toString: (encoding?: string) => string }).toString('utf8');
      this.handleMessage(payload);
    });

    ws.on('close', () => {
      this.clearHeartbeat(shard);
      if (!this.running) {
        return;
      }
      this.scheduleReconnect(shard);
      this.emit('reconnecting', shard.id);
    });

    ws.on('error', (error: unknown) => {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private sendSubscribe(shard: Shard): void {
    if (!shard.ws || shard.ws.readyState !== WebSocket.OPEN || shard.topics.length === 0) {
      return;
    }

    shard.ws.send(JSON.stringify({ op: 'subscribe', args: shard.topics }));
  }

  private setupHeartbeat(shard: Shard): void {
    this.clearHeartbeat(shard);
    shard.pingInterval = setInterval(() => {
      if (!shard.ws || shard.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      shard.ws.send(JSON.stringify({ op: 'ping' }));
    }, this.options.pingIntervalMs);
  }

  private clearHeartbeat(shard: Shard): void {
    if (shard.pingInterval) {
      clearInterval(shard.pingInterval);
      shard.pingInterval = undefined;
    }
  }

  private scheduleReconnect(shard: Shard): void {
    shard.reconnectAttempts += 1;
    const delay = backoffMs(
      shard.reconnectAttempts,
      this.options.reconnectBaseMs,
      this.options.reconnectMaxMs,
    );

    if (shard.reconnectTimeout) {
      clearTimeout(shard.reconnectTimeout);
    }
    shard.reconnectTimeout = setTimeout(() => this.connectShard(shard), delay);
  }

  private teardownShard(shard: Shard): void {
    if (shard.reconnectTimeout) {
      clearTimeout(shard.reconnectTimeout);
      shard.reconnectTimeout = undefined;
    }
    this.clearHeartbeat(shard);

    if (shard.ws) {
      (shard.ws as any).removeAllListeners();
      if (shard.ws.readyState === WebSocket.OPEN || shard.ws.readyState === WebSocket.CONNECTING) {
        shard.ws.close();
      }
      shard.ws = undefined;
    }
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const control = message as BybitPublicControlMessage;
    if (control.op || control.type === 'pong') {
      return;
    }

    const ticker = parseTickerMessage(message);
    if (ticker) {
      const prev = this.tickerState.get(ticker.symbol) ?? {};
      const merged = { ...prev, ...ticker.patch };
      this.tickerState.set(ticker.symbol, merged);
      this.onTickerCb?.(ticker.symbol, ticker.patch);
      this.emit('ticker', ticker.symbol, ticker.patch);
      return;
    }

    const klines = parseKlineMessage(message);
    if (!klines) {
      return;
    }

    for (const event of klines) {
      this.onKlineCb?.(event.symbol, event.tfMin, event.candle);
      this.emit('kline', event.symbol, event.tfMin, event.candle);
    }
  }

  private handleError(error: Error): void {
    this.onErrorCb?.(error);
    this.emit('ws_error', error);
  }
}
