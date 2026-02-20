import type { InstrumentSpec } from '../bybit';
import type { OrderSide, SessionStartRequest, SymbolStatus } from '../api/dto';
import { estimateFeeUSDT } from './fees';
import { floorToStep, roundDownToTick, roundUpToTick } from './rounding';

export interface BrokerEvent {
  type:
    | 'order_placed'
    | 'order_filled'
    | 'order_expired'
    | 'order_canceled'
    | 'position_opened'
    | 'position_closed';
  symbol: string;
  data: Record<string, unknown>;
}

type PositionSide = 'LONG' | 'SHORT';

interface InternalOrder {
  side: OrderSide;
  type: 'LIMIT';
  status: 'OPEN';
  placedTs: number;
  expiresTs: number;
  price: number;
  qty: number;
}

interface InternalPosition {
  side: PositionSide;
  entryTs: number;
  entryPrice: number;
  qty: number;
  tpPrice: number;
  slPrice: number;
  fundingAccruedUSDT: number;
  feesPaidUSDT: number;
  unrealizedPnlUSDT: number;
  unrealizedRoiPct: number;
}

interface SymbolTradeState {
  order: InternalOrder | null;
  position: InternalPosition | null;
  rearmAtTs: number | null;
}

export class PaperBroker {
  private readonly bySymbol = new Map<string, SymbolTradeState>();

  initialize(symbols: string[]): void {
    this.bySymbol.clear();
    for (const symbol of symbols) {
      this.bySymbol.set(symbol, { order: null, position: null, rearmAtTs: null });
    }
  }

  getOrder(symbol: string): InternalOrder | null {
    return this.bySymbol.get(symbol)?.order ?? null;
  }

  getPosition(symbol: string): InternalPosition | null {
    return this.bySymbol.get(symbol)?.position ?? null;
  }

  canArm(symbol: string, nowTs: number): boolean {
    const state = this.bySymbol.get(symbol);
    if (!state) {
      return false;
    }
    if (state.order || state.position) {
      return false;
    }
    return state.rearmAtTs === null || nowTs >= state.rearmAtTs;
  }

  placeEntryOrder(input: {
    symbol: string;
    side: PositionSide;
    markPrice: number;
    nowTs: number;
    config: SessionStartRequest;
    instrument: InstrumentSpec;
  }): BrokerEvent[] {
    const state = this.bySymbol.get(input.symbol);
    if (!state || state.order || state.position) {
      return [];
    }

    const orderSide: OrderSide = input.side === 'LONG' ? 'BUY' : 'SELL';
    const unroundedPrice =
      input.side === 'LONG'
        ? input.markPrice * (1 - input.config.trade.entryOffsetPct / 100)
        : input.markPrice * (1 + input.config.trade.entryOffsetPct / 100);

    const price =
      orderSide === 'BUY'
        ? roundDownToTick(unroundedPrice, input.instrument.tickSize)
        : roundUpToTick(unroundedPrice, input.instrument.tickSize);

    const notional = input.config.trade.marginUSDT * input.config.trade.leverage;
    const qtyRaw = notional / price;
    const qty = floorToStep(qtyRaw, input.instrument.qtyStep);
    if (qty < input.instrument.minQty || qty <= 0) {
      return [];
    }

    state.order = {
      side: orderSide,
      type: 'LIMIT',
      status: 'OPEN',
      placedTs: input.nowTs,
      expiresTs: input.nowTs + input.config.trade.entryOrderTimeoutMin * 60_000,
      price,
      qty,
    };
    state.rearmAtTs = null;

    return [
      {
        type: 'order_placed',
        symbol: input.symbol,
        data: {
          side: orderSide,
          price,
          qty,
          placedTs: state.order.placedTs,
          expiresTs: state.order.expiresTs,
        },
      },
    ];
  }

  processTick(nowTs: number, markBySymbol: Map<string, number>, config: SessionStartRequest): BrokerEvent[] {
    const events: BrokerEvent[] = [];

    for (const [symbol, state] of this.bySymbol.entries()) {
      const markPrice = markBySymbol.get(symbol);

      if (state.order && markPrice !== undefined) {
        const isFilled =
          (state.order.side === 'BUY' && markPrice <= state.order.price) ||
          (state.order.side === 'SELL' && markPrice >= state.order.price);

        if (isFilled) {
          const positionSide: PositionSide = state.order.side === 'BUY' ? 'LONG' : 'SHORT';
          const entryNotional = state.order.price * state.order.qty;
          const entryFee = estimateFeeUSDT(entryNotional, config.fees.makerRate);
          const position = this.makePosition(positionSide, state.order.price, state.order.qty, nowTs, config, entryFee);

          events.push({
            type: 'order_filled',
            symbol,
            data: {
              side: state.order.side,
              price: state.order.price,
              qty: state.order.qty,
              filledTs: nowTs,
            },
          });
          events.push({
            type: 'position_opened',
            symbol,
            data: {
              side: position.side,
              entryTs: position.entryTs,
              entryPrice: position.entryPrice,
              qty: position.qty,
              tpPrice: position.tpPrice,
              slPrice: position.slPrice,
              feesPaidUSDT: position.feesPaidUSDT,
            },
          });

          state.order = null;
          state.position = position;
          state.rearmAtTs = null;
        } else if (nowTs >= state.order.expiresTs) {
          events.push({
            type: 'order_expired',
            symbol,
            data: {
              side: state.order.side,
              price: state.order.price,
              qty: state.order.qty,
              expiredTs: nowTs,
            },
          });
          state.order = null;
          state.rearmAtTs = nowTs + 1_000;
        }
      }

      if (state.position && markPrice !== undefined) {
        const rawPnl =
          state.position.side === 'LONG'
            ? (markPrice - state.position.entryPrice) * state.position.qty
            : (state.position.entryPrice - markPrice) * state.position.qty;
        state.position.unrealizedPnlUSDT = rawPnl;
        state.position.unrealizedRoiPct = (rawPnl / config.trade.marginUSDT) * 100;
      }
    }

    return events;
  }

  closeAllOnStop(nowTs: number, markBySymbol: Map<string, number>, instrumentBySymbol: Record<string, InstrumentSpec>): BrokerEvent[] {
    const events: BrokerEvent[] = [];

    for (const [symbol, state] of this.bySymbol.entries()) {
      if (state.order) {
        events.push({
          type: 'order_canceled',
          symbol,
          data: {
            side: state.order.side,
            price: state.order.price,
            qty: state.order.qty,
            canceledTs: nowTs,
            reason: 'STOP',
          },
        });
        state.order = null;
      }

      if (state.position) {
        const markPrice = markBySymbol.get(symbol);
        const spec = instrumentBySymbol[symbol];
        const closePrice =
          markPrice !== undefined && spec
            ? state.position.side === 'LONG'
              ? roundDownToTick(markPrice, spec.tickSize)
              : roundUpToTick(markPrice, spec.tickSize)
            : state.position.entryPrice;

        events.push({
          type: 'position_closed',
          symbol,
          data: {
            side: state.position.side,
            entryPrice: state.position.entryPrice,
            closePrice,
            qty: state.position.qty,
            closedTs: nowTs,
            reason: 'STOP',
          },
        });
        state.position = null;
      }

      state.rearmAtTs = nowTs + 1_000;
    }

    return events;
  }

  getCounts(): { ordersActive: number; positionsOpen: number } {
    let ordersActive = 0;
    let positionsOpen = 0;

    for (const state of this.bySymbol.values()) {
      if (state.order) {
        ordersActive += 1;
      }
      if (state.position) {
        positionsOpen += 1;
      }
    }

    return { ordersActive, positionsOpen };
  }

  private makePosition(
    side: PositionSide,
    entryPrice: number,
    qty: number,
    entryTs: number,
    config: SessionStartRequest,
    entryFee: number,
  ): InternalPosition {
    const rTP = config.trade.tpRoiPct / 100;
    const rSL = config.trade.slRoiPct / 100;
    const leverage = config.trade.leverage;

    const tpPrice =
      side === 'LONG' ? entryPrice * (1 + rTP / leverage) : entryPrice * (1 - rTP / leverage);
    const slPrice =
      side === 'LONG' ? entryPrice * (1 - rSL / leverage) : entryPrice * (1 + rSL / leverage);

    return {
      side,
      entryTs,
      entryPrice,
      qty,
      tpPrice,
      slPrice,
      fundingAccruedUSDT: 0,
      feesPaidUSDT: entryFee,
      unrealizedPnlUSDT: 0,
      unrealizedRoiPct: 0,
    };
  }

  getSymbolStatus(symbol: string, hasMarketRefs: boolean, nowTs: number): SymbolStatus {
    const state = this.bySymbol.get(symbol);
    if (!state || !hasMarketRefs) {
      return 'IDLE';
    }
    if (state.position) {
      return 'POSITION_OPEN';
    }
    if (state.order) {
      return 'ORDER_PLACED';
    }
    if (state.rearmAtTs !== null && nowTs < state.rearmAtTs) {
      return 'IDLE';
    }
    return 'ARMED';
  }
}
