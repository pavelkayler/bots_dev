import { randomUUID } from "node:crypto";
import { BybitDemoRestClient } from "../bybit/BybitDemoRestClient.js";
import type { EventLogger } from "../logging/EventLogger.js";
import type { PaperBrokerConfig, PaperStats, PaperSide } from "../paper/PaperBroker.js";

type TickInput = {
  symbol: string;
  nowMs: number;
  markPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  signal: PaperSide | null;
  signalReason: string;
  cooldownActive: boolean;
};

type SymbolState = {
  positionOpen: boolean;
  side: PaperSide | null;
  entryPrice: number | null;
  qty: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  pendingEntry: boolean;
  pendingOrderLinkId: string | null;
  placedAt: number | null;
  expiresAt: number | null;
  cooldownUntil: number;
};

function calcTpSl(entry: number, side: PaperSide, leverage: number, tpRoiPct: number, slRoiPct: number) {
  const tpMove = (tpRoiPct / 100) / leverage;
  const slMove = (slRoiPct / 100) / leverage;
  if (side === "LONG") return { tp: entry * (1 + tpMove), sl: entry * (1 - slMove) };
  return { tp: entry * (1 - tpMove), sl: entry * (1 + slMove) };
}

export class DemoBroker {
  private readonly cfg: PaperBrokerConfig;
  private readonly logger: EventLogger;
  private readonly rest = new BybitDemoRestClient();
  private readonly map = new Map<string, SymbolState>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private reconcileBusy = false;
  private missingKeysLogged = false;
  private openOrdersCache: Array<{ symbol: string; orderLinkId: string }> = [];

  constructor(cfg: PaperBrokerConfig, logger: EventLogger, private readonly getMarkPrice?: (symbol: string) => number | null) {
    this.cfg = cfg;
    this.logger = logger;
  }

  private getState(symbol: string): SymbolState {
    const current = this.map.get(symbol);
    if (current) return current;
    const created: SymbolState = {
      positionOpen: false,
      side: null,
      entryPrice: null,
      qty: null,
      tpPrice: null,
      slPrice: null,
      pendingEntry: false,
      pendingOrderLinkId: null,
      placedAt: null,
      expiresAt: null,
      cooldownUntil: 0,
    };
    this.map.set(symbol, created);
    return created;
  }

  private clearPending(st: SymbolState) {
    st.pendingEntry = false;
    st.pendingOrderLinkId = null;
    st.placedAt = null;
    st.expiresAt = null;
  }

  start() {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, 1500);
  }

  stop() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  getStats(): PaperStats {
    let openPositions = 0;
    for (const st of this.map.values()) {
      if (st.positionOpen) openPositions += 1;
    }
    return {
      openPositions,
      pendingOrders: this.openOrdersCache.length,
      closedTrades: 0,
      wins: 0,
      losses: 0,
      netRealized: 0,
      feesPaid: 0,
      fundingAccrued: 0,
    };
  }

  async tick(args: TickInput) {
    if (!this.cfg.enabled) return;
    if (!this.rest.hasCredentials()) {
      if (!this.missingKeysLogged) {
        this.missingKeysLogged = true;
        this.logger.log({ ts: args.nowMs, type: "DEMO_DISABLED_NO_KEYS", symbol: args.symbol, payload: { reason: "missing_demo_api_keys" } });
      }
      return;
    }

    const st = this.getState(args.symbol);
    if (!args.signal || args.cooldownActive || args.nowMs < st.cooldownUntil) return;

    if (st.pendingEntry && st.expiresAt != null && args.nowMs > st.expiresAt && st.pendingOrderLinkId) {
      try {
        await this.rest.cancelOrderLinear({ symbol: args.symbol, orderLinkId: st.pendingOrderLinkId });
        this.logger.log({ ts: args.nowMs, type: "DEMO_ORDER_CANCEL_TIMEOUT", symbol: args.symbol, payload: { orderLinkId: st.pendingOrderLinkId } });
      } catch {
      }
      st.cooldownUntil = args.nowMs + this.cfg.rearmDelayMs;
      this.clearPending(st);
      return;
    }

    if (st.positionOpen || st.pendingEntry) return;

    const side = args.signal === "LONG" ? "Buy" : "Sell";
    const offset = this.cfg.entryOffsetPct / 100;
    const markPrice = Number.isFinite(args.markPrice) ? args.markPrice : (this.getMarkPrice?.(args.symbol) ?? 0);
    if (!Number.isFinite(markPrice) || markPrice <= 0) return;
    const price = args.signal === "LONG" ? markPrice * (1 - offset) : markPrice * (1 + offset);
    const notional = this.cfg.marginUSDT * this.cfg.leverage;
    const qty = Math.round((notional / markPrice) * 1000) / 1000;
    const levels = calcTpSl(price, args.signal, this.cfg.leverage, this.cfg.tpRoiPct, this.cfg.slRoiPct);
    const orderLinkId = `demo-entry-${randomUUID()}`;

    await this.rest.placeOrderLinear({
      symbol: args.symbol,
      side,
      orderType: "Limit",
      qty: qty.toFixed(3),
      price: price.toFixed(6),
      timeInForce: "GTC",
      takeProfit: levels.tp.toFixed(6),
      stopLoss: levels.sl.toFixed(6),
      orderLinkId,
    });

    this.logger.log({
      ts: args.nowMs,
      type: "DEMO_ORDER_PLACE",
      symbol: args.symbol,
      payload: { side, qty, price, tp: levels.tp, sl: levels.sl, orderLinkId, reason: args.signalReason },
    });

    st.pendingEntry = true;
    st.pendingOrderLinkId = orderLinkId;
    st.placedAt = args.nowMs;
    st.expiresAt = args.nowMs + this.cfg.entryTimeoutSec * 1000;
    st.side = args.signal;
    st.qty = qty;
    st.entryPrice = price;
    st.tpPrice = levels.tp;
    st.slPrice = levels.sl;
  }

  private async reconcile() {
    if (this.reconcileBusy || !this.rest.hasCredentials()) return;
    this.reconcileBusy = true;
    const nowMs = Date.now();

    try {
      const [positionsResp, openOrdersResp] = await Promise.all([this.rest.getPositionsLinear(), this.rest.getOpenOrdersLinear()]);

      const openOrders = Array.isArray(openOrdersResp.list) ? openOrdersResp.list : [];
      this.openOrdersCache = openOrders
        .map((o) => ({ symbol: String(o.symbol ?? ""), orderLinkId: String(o.orderLinkId ?? "") }))
        .filter((o) => o.symbol.length > 0 && o.orderLinkId.length > 0);

      const positions = (Array.isArray(positionsResp.list) ? positionsResp.list : []).filter((p) => Number(p.size ?? "0") > 0);
      const positionBySymbol = new Map(positions.map((p) => [String(p.symbol ?? ""), p]));

      for (const [symbol, st] of this.map.entries()) {
        const hasOpenOrder = st.pendingOrderLinkId
          ? openOrders.some((o) => String(o.orderLinkId ?? "") === st.pendingOrderLinkId && String(o.symbol ?? "") === symbol)
          : false;
        const serverPos = positionBySymbol.get(symbol);

        if (st.pendingEntry && !hasOpenOrder && serverPos) {
          st.positionOpen = true;
          st.side = String(serverPos.side ?? "").toLowerCase() === "sell" ? "SHORT" : "LONG";
          st.entryPrice = Number(serverPos.avgPrice ?? 0) || st.entryPrice;
          st.qty = Number(serverPos.size ?? 0) || st.qty;

          this.logger.log({ ts: nowMs, type: "DEMO_POSITION_OPEN", symbol, payload: { side: st.side, entryPrice: st.entryPrice, qty: st.qty } });

          if (!serverPos.takeProfit || !serverPos.stopLoss) {
            try {
              const stopParams: { symbol: string; takeProfit?: string; stopLoss?: string } = { symbol };
              if (st.tpPrice != null) stopParams.takeProfit = st.tpPrice.toFixed(6);
              if (st.slPrice != null) stopParams.stopLoss = st.slPrice.toFixed(6);
              await this.rest.setTradingStopLinear(stopParams);
            } catch {
            }
          }
          this.clearPending(st);
        }

        if (st.pendingEntry && !hasOpenOrder && !serverPos) this.clearPending(st);

        if (st.positionOpen && !serverPos) {
          this.logger.log({ ts: nowMs, type: "DEMO_POSITION_CLOSE", symbol, payload: { reason: "UNKNOWN" } });
          st.positionOpen = false;
          st.side = null;
          st.entryPrice = null;
          st.qty = null;
          st.tpPrice = null;
          st.slPrice = null;
          st.cooldownUntil = nowMs + this.cfg.rearmDelayMs;
        }
      }

      for (const [symbol, serverPos] of positionBySymbol.entries()) {
        if (!symbol) continue;
        const st = this.getState(symbol);
        st.positionOpen = true;
        st.side = String(serverPos.side ?? "").toLowerCase() === "sell" ? "SHORT" : "LONG";
        st.entryPrice = Number(serverPos.avgPrice ?? 0) || st.entryPrice;
        st.qty = Number(serverPos.size ?? 0) || st.qty;
      }
    } catch {
    } finally {
      this.reconcileBusy = false;
    }
  }
}
