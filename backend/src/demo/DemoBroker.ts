import crypto from "node:crypto";
import { BybitDemoRestClient } from "../bybit/BybitDemoRestClient.js";
import { decimalsFromStep, formatToDecimals, pickLinearMeta, roundDownToStep, roundUpToStep, type LinearInstrumentMeta } from "../bybit/instrumentsMeta.js";
import type { EventLogger } from "../logging/EventLogger.js";
import type { PaperBrokerConfig, PaperSide } from "../paper/PaperBroker.js";

export type DemoStats = {
  mode: "demo";
  openPositions: number;
  openOrders: number;
  pendingEntries: number;
  lastReconcileAtMs: number;
  tradesCount: number;
  realizedPnlUsdt: number;
  feesUsdt: number;
  lastExecTimeMs: number | null;
};

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
  private executionsTimer: NodeJS.Timeout | null = null;
  private reconcileBusy = false;
  private executionsBusy = false;
  private missingKeysLogged = false;
  private openOrdersCache: Array<{ symbol: string; orderLinkId: string }> = [];
  private metaBySymbol = new Map<string, LinearInstrumentMeta>();
  private leverageSet = new Set<string>();
  private missingMetaLogged = new Set<string>();
  private lastReconcileAtMs = 0;
  private openOrdersCount = 0;
  private openPositionsCount = 0;
  private lastExecTimeMs: number | null = null;
  private execSeenIds = new Set<string>();
  private execSeenQueue: string[] = [];
  private demoTradesCount = 0;
  private demoRealizedPnlUsdt = 0;
  private demoFeesUsdt = 0;
  public sessionStartBalanceUsdt: number | null = null;
  public sessionEndBalanceUsdt: number | null = null;

  constructor(cfg: PaperBrokerConfig, logger: EventLogger, private readonly getMarkPrice?: (symbol: string) => number | null) {
    this.cfg = cfg;
    this.logger = logger;
  }

  private onTickRestError(args: TickInput, stage: string, err: any, st?: SymbolState) {
    this.logger.log({
      ts: args.nowMs,
      type: "DEMO_ORDER_ERROR",
      symbol: args.symbol,
      payload: {
        stage,
        retCode: err?.retCode,
        retMsg: err?.retMsg,
      },
    });
    if (st) {
      st.cooldownUntil = args.nowMs + this.cfg.rearmDelayMs;
      if (stage === "placeOrder" || stage === "cancel") this.clearPending(st);
    }
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
    if (!this.executionsTimer) {
      this.executionsTimer = setInterval(() => {
        void this.pollExecutions();
      }, 5000);
    }
  }

  stop() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.executionsTimer) {
      clearInterval(this.executionsTimer);
      this.executionsTimer = null;
    }
  }

  getStats(): DemoStats {
    let pendingEntries = 0;
    for (const st of this.map.values()) {
      if (st.pendingEntry) pendingEntries += 1;
    }
    return {
      mode: "demo",
      openPositions: this.openPositionsCount,
      openOrders: this.openOrdersCount,
      pendingEntries,
      lastReconcileAtMs: this.lastReconcileAtMs,
      tradesCount: this.demoTradesCount,
      realizedPnlUsdt: this.demoRealizedPnlUsdt,
      feesUsdt: this.demoFeesUsdt,
      lastExecTimeMs: this.lastExecTimeMs,
    };
  }

  private parseNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private trackExecSeen(execId: string) {
    if (!execId || this.execSeenIds.has(execId)) return;
    this.execSeenIds.add(execId);
    this.execSeenQueue.push(execId);
    if (this.execSeenQueue.length > 2000) {
      const removed = this.execSeenQueue.shift();
      if (removed) this.execSeenIds.delete(removed);
    }
  }

  private async pollExecutions() {
    if (this.executionsBusy || !this.rest.hasCredentials()) return;
    this.executionsBusy = true;
    const nowMs = Date.now();
    try {
      const startTime = this.lastExecTimeMs != null ? this.lastExecTimeMs - 2000 : nowMs - (15 * 60 * 1000);
      const resp = await this.rest.getExecutionsLinear({ startTime, limit: 100 });
      const list = Array.isArray(resp.list) ? resp.list : [];
      for (const exec of list) {
        const execId = String(exec.execId ?? "");
        if (!execId || this.execSeenIds.has(execId)) continue;
        this.trackExecSeen(execId);
        this.demoTradesCount += 1;
        this.demoRealizedPnlUsdt += this.parseNumber(exec.closedPnl);
        this.demoFeesUsdt += this.parseNumber(exec.execFee);
        const execTimeMs = Number(exec.execTime ?? 0);
        if (Number.isFinite(execTimeMs) && execTimeMs > 0) {
          this.lastExecTimeMs = this.lastExecTimeMs == null ? execTimeMs : Math.max(this.lastExecTimeMs, execTimeMs);
        }
      }
    } catch (err: any) {
      this.logger.log({
        ts: nowMs,
        type: "DEMO_ORDER_ERROR",
        payload: {
          stage: "executions",
          retCode: err?.retCode,
          retMsg: err?.retMsg,
        },
      });
    } finally {
      this.executionsBusy = false;
    }
  }

  async getWalletUsdtBalance(): Promise<number | null> {
    if (!this.rest.hasCredentials()) return null;
    try {
      const result: any = await this.rest.getWalletBalance({ coin: "USDT" });
      const accounts = Array.isArray(result?.list) ? result.list : [];
      for (const account of accounts) {
        const coins = Array.isArray(account?.coin) ? account.coin : [];
        const usdt = coins.find((c: any) => String(c?.coin ?? "").toUpperCase() === "USDT");
        if (!usdt) continue;
        const candidates = [usdt.walletBalance, usdt.equity, usdt.availableToWithdraw, usdt.availableBalance];
        for (const value of candidates) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async getMeta(symbol: string): Promise<LinearInstrumentMeta | null> {
    const cached = this.metaBySymbol.get(symbol);
    if (cached) return cached;
    const list = await this.rest.getInstrumentsInfoLinear({ symbol });
    const meta = pickLinearMeta(list[0]);
    if (!meta) return null;
    this.metaBySymbol.set(symbol, meta);
    return meta;
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
      } catch (err: any) {
        this.onTickRestError(args, "cancel", err, st);
      }
      st.cooldownUntil = args.nowMs + this.cfg.rearmDelayMs;
      this.clearPending(st);
      return;
    }

    if (st.positionOpen || st.pendingEntry) return;

    const side = args.signal === "LONG" ? "Buy" : "Sell";
    const positionIdx = args.signal === "LONG" ? 1 : 2;
    const offset = this.cfg.entryOffsetPct / 100;
    const markPrice = Number.isFinite(args.markPrice) ? args.markPrice : (this.getMarkPrice?.(args.symbol) ?? 0);
    if (!Number.isFinite(markPrice) || markPrice <= 0) return;

    let meta: LinearInstrumentMeta | null;
    try {
      meta = await this.getMeta(args.symbol);
    } catch (err: any) {
      this.onTickRestError(args, "getMeta", err, st);
      return;
    }
    if (!meta) {
      if (!this.missingMetaLogged.has(args.symbol)) {
        this.missingMetaLogged.add(args.symbol);
        this.logger.log({ ts: args.nowMs, type: "DEMO_META_MISSING", symbol: args.symbol, payload: { reason: "instrument_meta_unavailable" } });
      }
      return;
    }

    if (!this.leverageSet.has(args.symbol)) {
      try {
        await this.rest.setLeverageLinear({
          symbol: args.symbol,
          buyLeverage: String(this.cfg.leverage),
          sellLeverage: String(this.cfg.leverage),
        });
      } catch (err: any) {
        this.onTickRestError(args, "setLeverage", err, st);
      } finally {
        this.leverageSet.add(args.symbol);
      }
    }

    const priceRaw = args.signal === "LONG" ? markPrice * (1 - offset) : markPrice * (1 + offset);
    const notional = this.cfg.marginUSDT * this.cfg.leverage;
    const qtyRaw = notional / markPrice;
    const qtyRounded = roundDownToStep(qtyRaw, meta.qtyStep);
    if (qtyRounded < meta.minOrderQty) {
      st.cooldownUntil = args.nowMs + this.cfg.rearmDelayMs;
      this.logger.log({
        ts: args.nowMs,
        type: "DEMO_QTY_TOO_SMALL",
        symbol: args.symbol,
        payload: { qtyRaw, qtyRounded, minOrderQty: meta.minOrderQty },
      });
      return;
    }

    const priceRounded = args.signal === "LONG"
      ? roundDownToStep(priceRaw, meta.tickSize)
      : roundUpToStep(priceRaw, meta.tickSize);
    const levelsRaw = calcTpSl(priceRaw, args.signal, this.cfg.leverage, this.cfg.tpRoiPct, this.cfg.slRoiPct);
    const tpRounded = args.signal === "LONG"
      ? roundUpToStep(levelsRaw.tp, meta.tickSize)
      : roundDownToStep(levelsRaw.tp, meta.tickSize);
    const slRounded = args.signal === "LONG"
      ? roundDownToStep(levelsRaw.sl, meta.tickSize)
      : roundUpToStep(levelsRaw.sl, meta.tickSize);
    const qtyDecimals = decimalsFromStep(meta.qtyStep);
    const priceDecimals = decimalsFromStep(meta.tickSize);
    const orderLinkId = "d" + crypto.randomBytes(16).toString("hex");

    try {
      await this.rest.placeOrderLinear({
        symbol: args.symbol,
        side,
        orderType: "Limit",
        qty: formatToDecimals(qtyRounded, qtyDecimals),
        price: formatToDecimals(priceRounded, priceDecimals),
        timeInForce: "GTC",
        takeProfit: formatToDecimals(tpRounded, priceDecimals),
        stopLoss: formatToDecimals(slRounded, priceDecimals),
        positionIdx,
        orderLinkId,
      });
    } catch (err: any) {
      this.onTickRestError(args, "placeOrder", err, st);
      return;
    }

    this.logger.log({
      ts: args.nowMs,
      type: "DEMO_ORDER_PLACE",
      symbol: args.symbol,
      payload: { side, qty: qtyRounded, price: priceRounded, tp: tpRounded, sl: slRounded, orderLinkId, reason: args.signalReason },
    });

    st.pendingEntry = true;
    st.pendingOrderLinkId = orderLinkId;
    st.placedAt = args.nowMs;
    st.expiresAt = args.nowMs + this.cfg.entryTimeoutSec * 1000;
    st.side = args.signal;
    st.qty = qtyRounded;
    st.entryPrice = priceRounded;
    st.tpPrice = tpRounded;
    st.slPrice = slRounded;
  }

  private async reconcile() {
    if (this.reconcileBusy || !this.rest.hasCredentials()) return;
    this.reconcileBusy = true;
    const nowMs = Date.now();

    try {
      const [positionsResp, openOrdersResp] = await Promise.all([
        this.rest.getPositionsLinear({ settleCoin: "USDT" }),
        this.rest.getOpenOrdersLinear({ settleCoin: "USDT" }),
      ]);

      const universeSymbols = new Set(Array.from(this.map.keys()));
      const allOpenOrders = Array.isArray(openOrdersResp.list) ? openOrdersResp.list : [];
      const openOrders = allOpenOrders.filter((o) => universeSymbols.size === 0 || universeSymbols.has(String(o.symbol ?? "")));
      this.lastReconcileAtMs = nowMs;
      this.openOrdersCount = openOrders.length;
      this.openOrdersCache = openOrders
        .map((o) => ({ symbol: String(o.symbol ?? ""), orderLinkId: String(o.orderLinkId ?? "") }))
        .filter((o) => o.symbol.length > 0 && o.orderLinkId.length > 0);

      const allPositions = (Array.isArray(positionsResp.list) ? positionsResp.list : []).filter((p) => Number(p.size ?? "0") > 0);
      const positions = allPositions.filter((p) => universeSymbols.size === 0 || universeSymbols.has(String(p.symbol ?? "")));
      this.openPositionsCount = positions.length;
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
    } catch (err: any) {
      this.logger.log({
        ts: nowMs,
        type: "DEMO_ORDER_ERROR",
        payload: {
          stage: "reconcile",
          retCode: err?.retCode,
          retMsg: err?.retMsg,
        },
      });
    } finally {
      this.reconcileBusy = false;
    }
  }
}
