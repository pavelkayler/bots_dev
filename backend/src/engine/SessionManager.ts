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
  ErrorMessage,
  SessionStatusResponse,
  SessionStopResponse,
  SnapshotMessage,
  SymbolRow,
  TickMessage,
} from '../api/dto';
import { CandleTracker } from './CandleTracker';
import { FundingCooldownGate } from './FundingCooldownGate';
import { MarketStateStore } from './MarketStateStore';
import { StrategyEngine } from './StrategyEngine';
import { UniverseBuilder } from './UniverseBuilder';
import type { InstrumentSpecMap } from './types';
import { PaperBroker, type BrokerEvent } from '../paper/PaperBroker';
import { EventLogger } from '../logging/EventLogger';
import type { MarketTick } from '../paper/models';

const TICK_MS = 1_000;
const DATA_STALE_MS = 5_000;

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
  private eventSeq = 0;
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
  private readonly fundingCooldownGate = new FundingCooldownGate();
  private readonly strategyEngine = new StrategyEngine();
  private readonly paperBroker = new PaperBroker();
  private readonly eventLogger = new EventLogger();

  private stateListeners: Array<(message: SessionStateMessage) => void> = [];
  private tickListeners: Array<(message: TickMessage) => void> = [];
  private eventsListeners: Array<(message: EventsAppendMessage) => void> = [];
  private errorListeners: Array<(message: ErrorMessage) => void> = [];

  constructor() {
    this.bybitWsClient.on('reconnecting', (payload: { shardId: number; attempt: number; reason: string }) => {
      this.emitError({
        type: 'error',
        ts: Date.now(),
        sessionId: this.sessionId,
        scope: 'BYBIT_WS',
        code: 'RECONNECTING',
        message: 'Disconnected from Bybit public WS; reconnect scheduled.',
        data: payload,
      });
      this.addAndEmitEvents([
        this.addEvent('error', 'SYSTEM', {
          scope: 'BYBIT_WS',
          code: 'RECONNECTING',
          ...payload,
          message: 'Disconnected from Bybit public WS; reconnect scheduled.',
        }),
      ]);
    });

    this.bybitWsClient.on('ws_error', (error: Error) => {
      this.addAndEmitEvents([
        this.addEvent('error', 'SYSTEM', {
          scope: 'BYBIT_WS',
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

  onError(listener: (message: ErrorMessage) => void): void {
    this.errorListeners.push(listener);
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
    this.eventSeq = 0;

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
    this.paperBroker.initialize(this.universe);
    this.rebuildSymbolRows();

    this.counts = { symbolsTotal: this.universe.length, ordersActive: 0, positionsOpen: 0 };
    this.eventLogger.start(this.sessionId);
    this.addAndEmitEvents([
      this.addEvent('session_started', 'SYSTEM', {
        config,
      }),
      this.addEvent('universe_built', 'SYSTEM', {
        count: this.universe.length,
        subscriptionReport: this.bybitWsClient.getSubscriptionReport(),
        filters: {
          minVolatility24hPct: config.universe.minVolatility24hPct,
          minTurnover24hUSDT: config.universe.minTurnover24hUSDT,
          maxSymbols: config.universe.maxSymbols,
        },
        symbols: this.universe,
      }),
    ]);

    this.emitState();
    this.tickOnce();
    this.startTicker();

    return { ok: true, sessionId: this.sessionId, state: 'RUNNING' };
  }

  async stop(): Promise<SessionStopResponse> {
    const activeSessionId = this.sessionId;

    if (this.state !== 'STOPPED') {
      this.state = 'STOPPING';
      this.emitState();

      if (this.config) {
        const nowTs = Date.now();
        const markBySymbol = this.getMarkBySymbol();
        const stopEvents = this.paperBroker.closeAllOnStop(
          nowTs,
          markBySymbol,
          this.instrumentSpecs,
          this.config,
        );
        this.addAndEmitEvents(stopEvents.map((event) => this.addEvent(event.type, event.symbol, event.data)));
        this.addAndEmitEvents([
          this.addEvent('session_stopped', 'SYSTEM', {
            canceledOrders: stopEvents.filter((event) => event.type === 'order_canceled').length,
            closedPositions: stopEvents.filter((event) => event.type === 'position_closed').length,
            stopTs: nowTs,
          }),
        ]);
      }

      this.stopTicker();
      this.bybitWsClient.stop();
      this.state = 'STOPPED';
      this.cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
      this.emitState();
      await this.eventLogger.stop();
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
    if (this.state === 'RUNNING' || this.state === 'COOLDOWN') {
      this.rebuildSymbolRows();
    }
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
      this.tickOnce();
    }, TICK_MS);
  }

  private tickOnce(): void {
    if ((this.state !== 'RUNNING' && this.state !== 'COOLDOWN') || !this.config) {
      return;
    }

    const nowTs = Date.now();
    this.runTradingLoop(nowTs, this.config);
    this.rebuildSymbolRows(nowTs);

    const tickMessage: TickMessage = {
      type: 'tick',
      ts: nowTs,
      session: { sessionId: this.sessionId, state: this.state },
      counts: this.counts,
      cooldown: this.cooldown,
      symbolsDelta: Array.from(this.symbols.values()),
    };

    for (const listener of this.tickListeners) {
      listener(tickMessage);
    }
  }

  private stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private rebuildSymbolRows(nowTs = Date.now()): void {
    this.symbols.clear();
    const isCooldownActive = this.cooldown.isActive;

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
      const dataStaleSec = this.marketStateStore.isDataStale(symbol, nowTs, DATA_STALE_MS);
      const dataReady =
        market?.fundingRate !== undefined && market?.nextFundingTime !== undefined && !dataStaleSec;
      const symbolStatus = this.paperBroker.getSymbolStatus(symbol, hasCandleRef && hasTickerBase && dataReady, nowTs);

      this.symbols.set(symbol, {
        symbol,
        status: symbolStatus,
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
        order: this.paperBroker.getOrder(symbol),
        position: this.paperBroker.getPosition(symbol),
        gates: { cooldownBlocked: isCooldownActive, dataReady },
      });
    }

    const brokerCounts = this.paperBroker.getCounts();
    this.counts = {
      symbolsTotal: this.universe.length,
      ordersActive: brokerCounts.ordersActive,
      positionsOpen: brokerCounts.positionsOpen,
    };
  }

  private runTradingLoop(nowTs: number, config: SessionStartRequest): void {
    const marketSnapshot = this.marketStateStore.snapshot(this.universe);
    const evaluatedCooldown = this.fundingCooldownGate.evaluate(
      this.universe,
      marketSnapshot,
      config.fundingCooldown,
      nowTs,
    );
    this.applyCooldownState(evaluatedCooldown);

    const markBySymbol = this.getMarkBySymbol(marketSnapshot);
    const marketBySymbol = this.getMarketBySymbol(marketSnapshot);
    const brokerEvents = this.paperBroker.processTick(nowTs, marketBySymbol, config);
    this.addAndEmitBrokerEvents(brokerEvents);

    if (this.cooldown.isActive) {
      return;
    }

    for (const symbol of this.universe) {
      const market = marketSnapshot.get(symbol);
      const candleRef = this.candleTracker.get(symbol);
      const hasCandleRef =
        candleRef?.prevCandleClose !== undefined && candleRef.prevCandleOivUSDT !== undefined;

      const decision = this.strategyEngine.evaluate(
        {
          symbol,
          markPrice: market?.markPrice,
          oivUSDT: market?.openInterestValue,
          fundingRate: market?.fundingRate,
          prevCandleClose: candleRef?.prevCandleClose,
          prevCandleOivUSDT: candleRef?.prevCandleOivUSDT,
          isArmed: this.paperBroker.canArm(symbol, nowTs) && hasCandleRef,
          dataReady:
            market?.fundingRate !== undefined &&
            market?.nextFundingTime !== undefined &&
            !this.marketStateStore.isDataStale(symbol, nowTs, DATA_STALE_MS),
          cooldownBlocked: this.cooldown.isActive,
        },
        config,
      );

      if (!decision || market?.markPrice === undefined) {
        continue;
      }

      const instrument = this.instrumentSpecs[symbol];
      if (!instrument) {
        continue;
      }

      const side = decision.side;
      const orderEvents = this.paperBroker.placeEntryOrder({
        symbol,
        side,
        markPrice: market.markPrice,
        nowTs,
        config,
        instrument,
      });

      if (orderEvents.length > 0) {
        this.addAndEmitEvents([
          this.addEvent('signal_fired', symbol, {
            tfMin: config.tfMin,
            decision: side,
            markPrice: market.markPrice,
            prevCandleClose: candleRef?.prevCandleClose,
            priceMovePct: decision.priceMovePct,
            oivUSDT: market.openInterestValue,
            prevCandleOivUSDT: candleRef?.prevCandleOivUSDT,
            oivMovePct: decision.oivMovePct,
            fundingRate: market.fundingRate,
            nextFundingTimeTs: market.nextFundingTime,
          }),
          ...orderEvents.map((event) => this.addEvent(event.type, event.symbol, event.data)),
        ]);
      }
    }
  }

  private applyCooldownState(nextCooldown: Cooldown): void {
    const wasActive = this.cooldown.isActive;
    const isActive = nextCooldown.isActive;
    this.cooldown = nextCooldown;

    if (!wasActive && isActive) {
      this.state = 'COOLDOWN';
      this.emitState();
      this.addAndEmitEvents([
        this.addEvent('cooldown_entered', 'SYSTEM', {
          fromTs: nextCooldown.fromTs,
          untilTs: nextCooldown.untilTs,
          nextFundingTimeTs: nextCooldown.untilTs,
        }),
      ]);
      return;
    }

    if (wasActive && !isActive) {
      this.state = 'RUNNING';
      this.emitState();
      this.addAndEmitEvents([
        this.addEvent('cooldown_exited', 'SYSTEM', {
          fromTs: nextCooldown.fromTs,
          untilTs: nextCooldown.untilTs,
        }),
      ]);
    }
  }

  private addAndEmitBrokerEvents(events: BrokerEvent[]): void {
    if (events.length === 0) {
      return;
    }
    this.addAndEmitEvents(events.map((event) => this.addEvent(event.type, event.symbol, event.data)));
  }

  private getMarkBySymbol(snapshot?: Map<string, { markPrice?: number }>): Map<string, number> {
    const output = new Map<string, number>();
    for (const symbol of this.universe) {
      const mark = snapshot?.get(symbol)?.markPrice ?? this.marketStateStore.get(symbol)?.markPrice;
      if (mark !== undefined) {
        output.set(symbol, mark);
      }
    }
    return output;
  }

  private getMarketBySymbol(snapshot?: Map<string, { markPrice?: number; fundingRate?: number; nextFundingTime?: number }>): Map<string, MarketTick> {
    const output = new Map<string, MarketTick>();
    for (const symbol of this.universe) {
      const market = snapshot?.get(symbol) ?? this.marketStateStore.get(symbol);
      if (!market) {
        continue;
      }
      output.set(symbol, {
        markPrice: market.markPrice,
        fundingRate: market.fundingRate,
        nextFundingTimeTs: market.nextFundingTime,
      });
    }
    return output;
  }

  private emitError(payload: ErrorMessage): void {
    for (const listener of this.errorListeners) {
      listener(payload);
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
    this.eventLogger.append(events);
    this.emitEvents(events);
  }

  private addEvent(type: EventRow['type'], symbol: string, data: Record<string, unknown>): EventRow {
    const event: EventRow = {
      id: `evt_${String(++this.eventSeq).padStart(6, '0')}`,
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
