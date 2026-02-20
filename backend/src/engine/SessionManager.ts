import { nanoid } from 'nanoid';
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

const DUMMY_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT'];

export class SessionManager {
  private sessionId: string | null = null;
  private state: SessionState = 'STOPPED';
  private tfMin = 5;
  private config: SessionStartRequest | null = null;
  private counts: Counts = { symbolsTotal: 0, ordersActive: 0, positionsOpen: 0 };
  private cooldown: Cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
  private symbols = new Map<string, SymbolRow>();
  private events: EventRow[] = [];
  private tickNo = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private stateListeners: Array<(message: SessionStateMessage) => void> = [];
  private tickListeners: Array<(message: TickMessage) => void> = [];
  private eventsListeners: Array<(message: EventsAppendMessage) => void> = [];

  onSessionState(listener: (message: SessionStateMessage) => void): void {
    this.stateListeners.push(listener);
  }

  onTick(listener: (message: TickMessage) => void): void {
    this.tickListeners.push(listener);
  }

  onEventsAppend(listener: (message: EventsAppendMessage) => void): void {
    this.eventsListeners.push(listener);
  }

  start(config: SessionStartRequest): SessionStartResponse {
    if (this.state !== 'STOPPED') {
      this.stop();
    }

    this.sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${nanoid(6)}`;
    this.state = 'RUNNING';
    this.tfMin = config.tfMin;
    this.config = config;
    this.cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
    this.events = [];
    this.tickNo = 0;
    this.bootstrapSymbols();
    this.addEvent('session_started', 'SYSTEM', { tfMin: this.tfMin });
    this.addEvent('universe_built', 'SYSTEM', { symbols: Array.from(this.symbols.keys()) });
    this.emitState();
    this.startTicker();

    return { ok: true, sessionId: this.sessionId, state: 'RUNNING' };
  }

  stop(): SessionStopResponse {
    const activeSessionId = this.sessionId;

    if (this.state !== 'STOPPED') {
      this.state = 'STOPPING';
      this.emitState();
      this.stopTicker();
      this.state = 'STOPPED';
      this.cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
      this.emitState();
      if (activeSessionId) {
        this.addEvent('session_stopped', 'SYSTEM', { sessionId: activeSessionId });
      }
      this.symbols.clear();
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
    return {
      type: 'snapshot',
      ts: Date.now(),
      session: { sessionId: this.sessionId, state: this.state, tfMin: this.tfMin },
      config: this.config,
      counts: this.counts,
      cooldown: this.cooldown,
      universe: Array.from(this.symbols.keys()),
      symbols: Array.from(this.symbols.values()),
      eventsTail: [...this.events],
    };
  }

  private bootstrapSymbols(): void {
    this.symbols.clear();
    const nextFundingTimeTs = Date.now() + 60 * 60 * 1000;

    for (const symbol of DUMMY_SYMBOLS) {
      const markPrice = this.randomBetween(100, 75000);
      const oivUSDT = this.randomBetween(2_000_000, 300_000_000);

      this.symbols.set(symbol, {
        symbol,
        status: 'ARMED',
        market: {
          markPrice,
          turnover24hUSDT: this.randomBetween(5_000_000, 2_500_000_000),
          volatility24hPct: this.randomBetween(3, 12),
          oivUSDT,
        },
        funding: {
          rate: this.randomBetween(-0.0005, 0.0005),
          nextFundingTimeTs,
          nextFundingTimeMsk: this.toMskString(nextFundingTimeTs),
          countdownSec: Math.max(0, Math.floor((nextFundingTimeTs - Date.now()) / 1000)),
        },
        signalMetrics: {
          prevCandleClose: markPrice,
          prevCandleOivUSDT: oivUSDT,
          priceMovePct: 0,
          oivMovePct: 0,
        },
        order: null,
        position: null,
        gates: { cooldownBlocked: false, dataReady: true },
      });
    }

    this.counts = { symbolsTotal: this.symbols.size, ordersActive: 0, positionsOpen: 0 };
  }

  private startTicker(): void {
    this.stopTicker();
    this.timer = setInterval(() => {
      if (this.state !== 'RUNNING' && this.state !== 'COOLDOWN') {
        return;
      }

      this.tickNo += 1;
      this.advanceCooldownPhases();

      const symbolsDelta: SymbolRow[] = [];
      for (const symbolRow of this.symbols.values()) {
        const markDelta = symbolRow.market.markPrice * this.randomBetween(-0.001, 0.001);
        const oivDelta = symbolRow.market.oivUSDT * this.randomBetween(-0.01, 0.01);

        symbolRow.market.markPrice = Number((symbolRow.market.markPrice + markDelta).toFixed(4));
        symbolRow.market.oivUSDT = Number((symbolRow.market.oivUSDT + oivDelta).toFixed(4));
        symbolRow.signalMetrics.priceMovePct = Number(
          (((symbolRow.market.markPrice - symbolRow.signalMetrics.prevCandleClose) / symbolRow.signalMetrics.prevCandleClose) *
            100).toFixed(3),
        );
        symbolRow.signalMetrics.oivMovePct = Number(
          (((symbolRow.market.oivUSDT - symbolRow.signalMetrics.prevCandleOivUSDT) /
            symbolRow.signalMetrics.prevCandleOivUSDT) *
            100).toFixed(3),
        );
        symbolRow.funding.countdownSec = Math.max(0, Math.floor((symbolRow.funding.nextFundingTimeTs - Date.now()) / 1000));
        symbolRow.gates.cooldownBlocked = this.state === 'COOLDOWN';

        symbolsDelta.push({ ...symbolRow });
      }

      const tickMessage: TickMessage = {
        type: 'tick',
        ts: Date.now(),
        session: { sessionId: this.sessionId, state: this.state },
        counts: this.counts,
        cooldown: this.cooldown,
        symbolsDelta,
      };

      for (const listener of this.tickListeners) {
        listener(tickMessage);
      }

      if (this.tickNo % 5 === 0) {
        const symbol = DUMMY_SYMBOLS[this.tickNo % DUMMY_SYMBOLS.length] ?? 'BTCUSDT';
        const event = this.addEvent('signal_fired', symbol, {
          tickNo: this.tickNo,
          note: 'dummy_event',
        });
        this.emitEvents([event]);
      }
    }, 1000);
  }

  private advanceCooldownPhases(): void {
    if (this.state === 'RUNNING' && this.tickNo % 20 === 0) {
      const fromTs = Date.now();
      const untilTs = fromTs + 15_000;
      this.state = 'COOLDOWN';
      this.cooldown = { isActive: true, reason: 'FUNDING_WINDOW', fromTs, untilTs };
      this.addEvent('cooldown_entered', 'SYSTEM', { fromTs, untilTs });
      this.emitState();
      return;
    }

    if (this.state === 'COOLDOWN' && this.cooldown.untilTs && Date.now() >= this.cooldown.untilTs) {
      this.state = 'RUNNING';
      this.cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
      this.addEvent('cooldown_exited', 'SYSTEM', {});
      this.emitState();
    }
  }

  private stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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


  private toMskString(ts: number): string {
    return new Date(ts + 3 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' MSK';
  }
  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
