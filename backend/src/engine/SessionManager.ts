import { DateTime } from 'luxon';
import { nanoid } from 'nanoid';
import { BybitWsClient, fetchInstrumentsInfoLinear, type InstrumentSpec } from '../bybit';
import type {
  Cooldown,
  Counts,
  EventRow,
  EventsAppendMessage,
  SessionStartRequest,
  SessionStartResponse,
  SessionState,
  SessionStateMessage,
  SessionStatusResponse,
  SessionStopResponse,
  SnapshotMessage,
  SymbolRow,
  TickMessage,
} from '../api/dto';
import { CandleTracker } from './CandleTracker';
import { MarketStateStore } from './MarketStateStore';
import { UniverseBuilder } from './UniverseBuilder';
import type { InstrumentSpecMap } from './types';

const TICK_MS = 1_000;

export class SessionManager {
  private sessionId: string | null = null;
  private state: SessionState = 'STOPPED';
  private tfMin = 5;
  private config: SessionStartRequest | null = null;
  private counts: Counts = { symbolsTotal: 0, ordersActive: 0, positionsOpen: 0 };
  private cooldown: Cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
  private symbols = new Map<string, SymbolRow>();
  private universe: string[] = [];
  private events: EventRow[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  private instrumentSpecs: InstrumentSpecMap = {};

  private readonly marketStateStore = new MarketStateStore();
  private readonly candleTracker = new CandleTracker(this.marketStateStore);
  private readonly bybitWsClient = new BybitWsClient({
    onTicker: (symbol, patch) => {
      this.marketStateStore.applyTickerPatch(symbol, patch);
    },
    onKline: (symbol, tfMin, candle) => {
      if (tfMin === this.tfMin) {
        this.candleTracker.onKline(symbol, candle);
      }
    },
  });

  private readonly universeBuilder = new UniverseBuilder(this.bybitWsClient, this.marketStateStore);

  private stateListeners: Array<(message: SessionStateMessage) => void> = [];
  private tickListeners: Array<(message: TickMessage) => void> = [];
  private eventsListeners: Array<(message: EventsAppendMessage) => void> = [];

  constructor() {
    this.bybitWsClient.on('reconnecting', (shardId: number) => {
      this.addAndEmitEvents([
        this.addEvent('error', 'SYSTEM', {
          code: 'BYBIT_WS_RECONNECTING',
          shardId,
          message: 'Disconnected from Bybit public WS; reconnect scheduled.',
        }),
      ]);
    });

    this.bybitWsClient.on('ws_error', (error: Error) => {
      this.addAndEmitEvents([
        this.addEvent('error', 'SYSTEM', {
          code: 'BYBIT_WS_ERROR',
          message: error.message,
        }),
      ]);
    });
  }

  onSessionState(listener: (message: SessionStateMessage) => void): void {
    this.stateListeners.push(listener);
  }

  onTick(listener: (message: TickMessage) => void): void {
    this.tickListeners.push(listener);
  }

  onEventsAppend(listener: (message: EventsAppendMessage) => void): void {
    this.eventsListeners.push(listener);
  }

  async start(config: SessionStartRequest): Promise<SessionStartResponse> {
    if (this.state !== 'STOPPED') {
      await this.stop();
    }

    this.sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${nanoid(6)}`;
    this.state = 'RUNNING';
    this.tfMin = config.tfMin;
    this.config = config;
    this.cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
    this.events = [];

    this.instrumentSpecs = await fetchInstrumentsInfoLinear();
    const candidateSymbols = this.buildCandidateSymbols(this.instrumentSpecs);

    const universeResult = await this.universeBuilder.build(
      {
        candidateSymbols,
        minVolatility24hPct: config.universe.minVolatility24hPct,
        minTurnover24hUSDT: config.universe.minTurnover24hUSDT,
        maxSymbols: config.universe.maxSymbols,
      },
      this.tfMin,
    );

    this.universe = universeResult.symbols;
    this.candleTracker.reset(this.universe);
    this.rebuildSymbolRows();

    this.counts = { symbolsTotal: this.universe.length, ordersActive: 0, positionsOpen: 0 };
    this.addAndEmitEvents([
      this.addEvent('session_started', 'SYSTEM', {
        tfMin: this.tfMin,
        config,
      }),
      this.addEvent('universe_built', 'SYSTEM', {
        count: this.universe.length,
        warmedSymbols: universeResult.warmedSymbols,
        symbols: this.universe,
      }),
    ]);

    this.emitState();
    this.startTicker();

    return { ok: true, sessionId: this.sessionId, state: 'RUNNING' };
  }

  async stop(): Promise<SessionStopResponse> {
    const activeSessionId = this.sessionId;

    if (this.state !== 'STOPPED') {
      this.state = 'STOPPING';
      this.emitState();
      this.stopTicker();
      this.bybitWsClient.stop();
      this.state = 'STOPPED';
      this.cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
      this.emitState();
      this.symbols.clear();
      this.universe = [];
      this.instrumentSpecs = {};
      this.counts = { symbolsTotal: 0, ordersActive: 0, positionsOpen: 0 };
      this.config = null;
      this.tfMin = 5;
      this.sessionId = null;
    }

    return { ok: true, sessionId: activeSessionId, state: 'STOPPED' };
  }

  getStatus(): SessionStatusResponse {
    return {
      ok: true,
      sessionId: this.sessionId,
      state: this.state,
      tfMin: this.tfMin,
      counts: this.counts,
      cooldown: this.cooldown,
    };
  }

  getSnapshot(): SnapshotMessage {
    this.rebuildSymbolRows();
    return {
      type: 'snapshot',
      ts: Date.now(),
      session: { sessionId: this.sessionId, state: this.state, tfMin: this.tfMin },
      config: this.config,
      counts: this.counts,
      cooldown: this.cooldown,
      universe: [...this.universe],
      symbols: Array.from(this.symbols.values()),
      eventsTail: [...this.events],
    };
  }

  private startTicker(): void {
    this.stopTicker();
    this.timer = setInterval(() => {
      if (this.state !== 'RUNNING' && this.state !== 'COOLDOWN') {
        return;
      }

      this.rebuildSymbolRows();

      const tickMessage: TickMessage = {
        type: 'tick',
        ts: Date.now(),
        session: { sessionId: this.sessionId, state: this.state },
        counts: this.counts,
        cooldown: this.cooldown,
        symbolsDelta: Array.from(this.symbols.values()),
      };

      for (const listener of this.tickListeners) {
        listener(tickMessage);
      }
    }, TICK_MS);
  }

  private stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private rebuildSymbolRows(): void {
    this.symbols.clear();

    for (const symbol of this.universe) {
      const market = this.marketStateStore.get(symbol);
      const candleRef = this.candleTracker.get(symbol);

      const markPrice = market?.markPrice ?? 0;
      const oiv = market?.openInterestValue ?? 0;
      const turnover = market?.turnover24h ?? 0;
      const high = market?.highPrice24h;
      const low = market?.lowPrice24h;
      const vol24hPct = low !== undefined && high !== undefined && low > 0 ? ((high - low) / low) * 100 : 0;

      const hasCandleRef =
        candleRef?.prevCandleClose !== undefined && candleRef.prevCandleOivUSDT !== undefined;
      const hasTickerBase = market?.markPrice !== undefined && market?.openInterestValue !== undefined;
      const prevCandleClose = candleRef?.prevCandleClose;
      const prevCandleOiv = candleRef?.prevCandleOivUSDT;

      const priceMovePct =
        prevCandleClose !== undefined && prevCandleClose !== 0
          ? ((markPrice - prevCandleClose) / prevCandleClose) * 100
          : 0;
      const oivMovePct =
        prevCandleOiv !== undefined && prevCandleOiv !== 0
          ? ((oiv - prevCandleOiv) / prevCandleOiv) * 100
          : 0;

      const nextFundingTimeTs = market?.nextFundingTime ?? 0;
      const fundingRate = market?.fundingRate ?? 0;
      const dataReady = market?.fundingRate !== undefined && market?.nextFundingTime !== undefined;

      this.symbols.set(symbol, {
        symbol,
        status: hasCandleRef && hasTickerBase ? 'ARMED' : 'IDLE',
        market: {
          markPrice,
          turnover24hUSDT: turnover,
          volatility24hPct: vol24hPct,
          oivUSDT: oiv,
        },
        funding: {
          rate: fundingRate,
          nextFundingTimeTs,
          nextFundingTimeMsk: this.toMskString(nextFundingTimeTs),
          countdownSec: Math.max(0, Math.floor((nextFundingTimeTs - Date.now()) / 1000)),
        },
        signalMetrics: {
          prevCandleClose: candleRef?.prevCandleClose ?? 0,
          prevCandleOivUSDT: prevCandleOiv ?? 0,
          priceMovePct,
          oivMovePct,
        },
        order: null,
        position: null,
        gates: { cooldownBlocked: false, dataReady },
      });
    }
  }

  private emitState(): void {
    const payload: SessionStateMessage = {
      type: 'session_state',
      ts: Date.now(),
      sessionId: this.sessionId,
      state: this.state,
      cooldown: this.cooldown,
    };

    for (const listener of this.stateListeners) {
      listener(payload);
    }
  }

  private emitEvents(events: EventRow[]): void {
    const payload: EventsAppendMessage = {
      type: 'events_append',
      ts: Date.now(),
      sessionId: this.sessionId,
      events,
    };

    for (const listener of this.eventsListeners) {
      listener(payload);
    }
  }

  private addAndEmitEvents(events: EventRow[]): void {
    if (events.length === 0) {
      return;
    }
    this.emitEvents(events);
  }

  private addEvent(type: EventRow['type'], symbol: string, data: Record<string, unknown>): EventRow {
    const event: EventRow = {
      id: `evt_${String(Date.now())}_${nanoid(4)}`,
      ts: Date.now(),
      type,
      symbol,
      data,
    };

    this.events.push(event);
    if (this.events.length > 200) {
      this.events = this.events.slice(-200);
    }
    return event;
  }

  private buildCandidateSymbols(specs: Record<string, InstrumentSpec>): string[] {
    return Object.keys(specs)
      .filter((symbol) => symbol.endsWith('USDT'))
      .sort();
  }

  private toMskString(ts: number): string {
    if (!ts) {
      return '-';
    }
    return DateTime.fromMillis(ts, { zone: 'utc' })
      .setZone('Europe/Moscow')
      .toFormat("yyyy-LL-dd HH:mm:ss 'MSK'");
  }
}
