import WebSocket from 'ws';
import { buildTopicsWithOptions, partitionTopicsByArgsLength } from './topicBuilder';
import {
  BYBIT_PUBLIC_LINEAR_WS_URL,
  BYBIT_WS_ARGS_MAX_CHARS,
  BYBIT_WS_PING_INTERVAL_MS,
  BYBIT_WS_RECONNECT_BASE_MS,
  BYBIT_WS_RECONNECT_MAX_MS,
  BYBIT_WS_WATCHDOG_TIMEOUT_MS,
  type BybitKlineRaw,
  type BybitSubscriptions,
  type BybitTickerRaw,
  type BybitTopicMessage,
  type BybitWsClientOptions,
  type KlineCandle,
  type TickerPatch,
} from './types';
import { getRunLogger, serializeUnknownError } from '../logging/RunLogger';

type Shard = {
  id: number;
  topics: string[];
  ws?: WebSocket;
  reconnectTimeout?: ReturnType<typeof setTimeout>;
  pingInterval?: ReturnType<typeof setInterval>;
  reconnectAttempts: number;
  lastMessageTs: number;
  watchdogInterval?: ReturnType<typeof setInterval>;
};

class SimpleEmitter {
  private listeners = new Map<string, Array<(payload: unknown) => void>>();

  on(event: string, listener: (payload: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  emit(event: string, payload: unknown): void {
    const list = this.listeners.get(event) ?? [];
    for (const listener of list) {
      listener(payload);
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
      | 'watchdogTimeoutMs'
    >
  >;

  private readonly onTickerCb?: BybitWsClientOptions['onTicker'];
  private readonly onKlineCb?: BybitWsClientOptions['onKline'];
  private readonly onErrorCb?: BybitWsClientOptions['onError'];
  private readonly runLogger = getRunLogger();

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
      watchdogTimeoutMs: opts.watchdogTimeoutMs ?? BYBIT_WS_WATCHDOG_TIMEOUT_MS,
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
    const nextTopicGroups = partitionTopicsByArgsLength(topics, this.options.argsMaxChars);
    const hasChanges = JSON.stringify(nextTopicGroups) !== JSON.stringify(this.topicGroups);
    this.topicGroups = nextTopicGroups;
    if (this.running && hasChanges) {
      this.recreateShards();
    }
  }

  getSubscriptionReport(): { totalSymbols: number; connections: number; topicsPerConnection: number[] } {
    return {
      totalSymbols: this.subscriptions.symbols.length,
      connections: this.topicGroups.length,
      topicsPerConnection: this.topicGroups.map((topics) => topics.length),
    };
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.runLogger.info('bybit_ws', 'client_start', { totalTopicGroups: this.topicGroups.length });
    this.recreateShards();
  }

  stop(): void {
    this.running = false;
    this.runLogger.info('bybit_ws', 'client_stop', { activeShards: this.shards.length });
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

    this.runLogger.info('bybit_ws', 'recreate_shards', {
      groups: this.topicGroups.length,
      topicsPerConnection: this.topicGroups.map((topics) => topics.length),
      totalTopics: this.topicGroups.reduce((acc, topics) => acc + topics.length, 0),
    });

    this.shards = this.topicGroups.map((topics, id) => ({
      id,
      topics,
      reconnectAttempts: 0,
      lastMessageTs: Date.now(),
    }));

    for (const shard of this.shards) {
      this.connectShard(shard);
    }
  }

  private connectShard(shard: Shard): void {
    if (!this.running) {
      return;
    }

    this.runLogger.info('bybit_ws', 'connect_attempt', {
      shardId: shard.id,
      reconnectAttempts: shard.reconnectAttempts,
      topicsCount: shard.topics.length,
      url: this.options.wsUrl,
    });

    const ws = new WebSocket(this.options.wsUrl);
    shard.ws = ws;

    ws.on('open', () => {
      shard.lastMessageTs = Date.now();
      shard.reconnectAttempts = 0;
      this.sendSubscribe(shard);
      this.setupHeartbeat(shard);
      this.setupWatchdog(shard);
      this.runLogger.info('bybit_ws', 'connected', {
        shardId: shard.id,
        topicsCount: shard.topics.length,
        reconnectAttempts: shard.reconnectAttempts,
      });
      this.emit('connected', shard.id);
    });

    ws.on('message', (raw: unknown) => {
      shard.lastMessageTs = Date.now();
      const payload = typeof raw === 'string' ? raw : (raw as { toString: (encoding?: string) => string }).toString('utf8');
      this.handleMessage(payload);
    });

    ws.on('close', (code: number, reasonBuffer: unknown) => {
      this.clearHeartbeat(shard);
      this.clearWatchdog(shard);
      if (!this.running) {
        return;
      }
      const attempt = this.scheduleReconnect(shard);
      this.runLogger.warn('bybit_ws', 'disconnected', {
        shardId: shard.id,
        code,
        reason: String(reasonBuffer ?? ''),
        attempt,
      });
      this.emit('reconnecting', { shardId: shard.id, attempt, reason: 'disconnected' });
    });

    ws.on('error', (error: unknown) => {
      this.runLogger.error('bybit_ws', 'socket_error', {
        shardId: shard.id,
        error: serializeUnknownError(error),
      });
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private sendSubscribe(shard: Shard): void {
    if (!shard.ws || shard.ws.readyState !== WebSocket.OPEN || shard.topics.length === 0) {
      return;
    }

    this.runLogger.info('bybit_ws', 'subscribe_sent', {
      shardId: shard.id,
      topicsCount: shard.topics.length,
      topicsGroups: this.topicGroups.length,
      symbolsCount: this.subscriptions.symbols.length,
    });
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

  private setupWatchdog(shard: Shard): void {
    this.clearWatchdog(shard);
    shard.watchdogInterval = setInterval(() => {
      if (!shard.ws || shard.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const staleMs = Date.now() - shard.lastMessageTs;
      if (staleMs <= this.options.watchdogTimeoutMs) {
        return;
      }
      this.runLogger.warn('bybit_ws', 'watchdog_timeout', {
        shardId: shard.id,
        staleMs,
        watchdogTimeoutMs: this.options.watchdogTimeoutMs,
        lastMessageTs: shard.lastMessageTs,
      });
      this.emit('reconnecting', {
        shardId: shard.id,
        attempt: shard.reconnectAttempts + 1,
        reason: 'watchdog_timeout',
      });
      const wsWithTerminate = shard.ws as WebSocket & { terminate?: () => void };
      wsWithTerminate.terminate?.();
    }, Math.min(this.options.pingIntervalMs, 5_000));
  }

  private clearWatchdog(shard: Shard): void {
    if (shard.watchdogInterval) {
      clearInterval(shard.watchdogInterval);
      shard.watchdogInterval = undefined;
    }
  }

  private scheduleReconnect(shard: Shard): number {
    shard.reconnectAttempts += 1;
    const delay = backoffMs(
      shard.reconnectAttempts,
      this.options.reconnectBaseMs,
      this.options.reconnectMaxMs,
    );

    if (shard.reconnectTimeout) {
      clearTimeout(shard.reconnectTimeout);
    }
    this.runLogger.warn('bybit_ws', 'reconnect_scheduled', {
      shardId: shard.id,
      attempt: shard.reconnectAttempts,
      delayMs: delay,
      lastMessageTs: shard.lastMessageTs,
    });
    shard.reconnectTimeout = setTimeout(() => this.connectShard(shard), delay);
    return shard.reconnectAttempts;
  }

  private teardownShard(shard: Shard): void {
    if (shard.reconnectTimeout) {
      clearTimeout(shard.reconnectTimeout);
      shard.reconnectTimeout = undefined;
    }
    this.clearHeartbeat(shard);
    this.clearWatchdog(shard);

    if (shard.ws) {
      const wsWithCleanup = shard.ws as WebSocket & { removeAllListeners?: () => void };
      wsWithCleanup.removeAllListeners?.();
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
    if (control.type === 'pong') {
      this.runLogger.info('bybit_ws', 'pong_received', {
        atTs: Date.now(),
      });
      return;
    }

    if (control.op) {
      return;
    }

    const ticker = parseTickerMessage(message);
    if (ticker) {
      const prev = this.tickerState.get(ticker.symbol) ?? {};
      const merged = { ...prev, ...ticker.patch };
      this.tickerState.set(ticker.symbol, merged);
      this.onTickerCb?.(ticker.symbol, ticker.patch);
      this.emit('ticker', { symbol: ticker.symbol, patch: ticker.patch });
      return;
    }

    const klines = parseKlineMessage(message);
    if (!klines) {
      return;
    }

    for (const event of klines) {
      this.onKlineCb?.(event.symbol, event.tfMin, event.candle);
      this.emit('kline', { symbol: event.symbol, tfMin: event.tfMin, candle: event.candle });
    }
  }

  private handleError(error: Error): void {
    this.runLogger.error('bybit_ws', 'handle_error', {
      error: serializeUnknownError(error),
    });
    this.onErrorCb?.(error);
    this.emit('ws_error', error);
  }
}
