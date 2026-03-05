import { BybitDemoRestClient } from "../bybit/BybitDemoRestClient.js";
import { decimalsFromStep, formatToDecimals, pickLinearMeta, roundDownToStep, roundUpToStep, type LinearInstrumentMeta } from "../bybit/instrumentsMeta.js";
import type { EventLogger } from "../logging/EventLogger.js";
import type { PaperBrokerConfig, PaperSide } from "../paper/PaperBroker.js";

export type DemoStats = {
  mode: "demo";
  openPositions: number;
  openOrders: number;
  globalOpenPositions: number;
  globalOpenOrders: number;
  trackedOpenPositions: number;
  trackedOpenOrders: number;
  pendingEntries: number;
  lastReconcileAtMs: number;
  tradesCount: number;
  realizedPnlUsdt: number;
  feesUsdt: number;
  lastExecTimeMs: number | null;
  startBalanceUsdt?: number | null;
  currentBalanceUsdt?: number | null;
  currentBalanceUpdatedAtMs?: number | null;
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
  executionState: "FLAT" | "OPENING" | "OPEN" | "CLOSING";
  entryAttempt: number;
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
  private openOrderSymbolsCache = new Set<string>();
  private metaBySymbol = new Map<string, LinearInstrumentMeta>();
  private leverageSet = new Set<string>();
  private leverageMaxBySymbol = new Map<string, number>();
  private readonly leverageFallbackBySymbol = new Map<string, number>([["SIRENUSDT", 5]]);
  private missingMetaLogged = new Set<string>();
  private lastReconcileAtMs = 0;
  private globalOpenOrdersCount = 0;
  private globalOpenPositionsCount = 0;
  private trackedOpenOrdersCount = 0;
  private trackedOpenPositionsCount = 0;
  private lastExecTimeMs: number | null = null;
  private execSeenIds = new Set<string>();
  private execSeenQueue: string[] = [];
  private demoTradesCount = 0;
  private demoRealizedPnlUsdt = 0;
  private demoFeesUsdt = 0;
  private currentBalanceUsdt: number | null = null;
  private currentBalanceUpdatedAtMs: number | null = null;
  private balancePollTimer: NodeJS.Timeout | null = null;
  public sessionStartBalanceUsdt: number | null = null;
  public sessionEndBalanceUsdt: number | null = null;

  constructor(
    cfg: PaperBrokerConfig,
    logger: EventLogger,
    private readonly runId: string,
    private readonly getMarkPrice?: (symbol: string) => number | null,
  ) {
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
      executionState: "FLAT",
      entryAttempt: 0,
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
    st.executionState = st.positionOpen ? "OPEN" : "FLAT";
  }

  private isLeverageInvalidError(err: any): boolean {
    const retCode = Number(err?.retCode);
    const retMsg = String(err?.retMsg ?? "").toLowerCase();
    return retCode === 10001 || retMsg.includes("leverage invalid");
  }

  private async resolveMaxLeverage(symbol: string): Promise<number | null> {
    const cached = this.leverageMaxBySymbol.get(symbol);
    if (Number.isFinite(cached) && cached && cached > 0) return cached;

    const fallback = this.leverageFallbackBySymbol.get(symbol);
    if (Number.isFinite(fallback) && fallback && fallback > 0) {
      this.leverageMaxBySymbol.set(symbol, fallback);
      return fallback;
    }

    try {
      const instruments = await this.rest.getInstrumentsInfoLinear({ symbol });
      const first = Array.isArray(instruments) ? instruments[0] : null;
      const maxLevRaw = Number((first as any)?.leverageFilter?.maxLeverage);
      if (Number.isFinite(maxLevRaw) && maxLevRaw > 0) {
        this.leverageMaxBySymbol.set(symbol, maxLevRaw);
        return maxLevRaw;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async ensureLeverageConfigured(args: TickInput, st: SymbolState): Promise<boolean> {
    if (this.leverageSet.has(args.symbol)) return true;

    const desiredLeverage = this.cfg.leverage;
    try {
      await this.rest.setLeverageLinear({
        symbol: args.symbol,
        buyLeverage: String(desiredLeverage),
        sellLeverage: String(desiredLeverage),
      });
      this.leverageSet.add(args.symbol);
      return true;
    } catch (err: any) {
      if (!this.isLeverageInvalidError(err)) {
        this.onTickRestError(args, "setLeverage", err, st);
        return false;
      }

      const maxLeverage = await this.resolveMaxLeverage(args.symbol);
      const fallbackLeverage = Number.isFinite(maxLeverage) && maxLeverage != null
        ? Math.max(1, Math.floor(Math.min(desiredLeverage, maxLeverage)))
        : null;
      if (!fallbackLeverage || fallbackLeverage === desiredLeverage) {
        this.onTickRestError(args, "setLeverage", err, st);
        return false;
      }

      try {
        await this.rest.setLeverageLinear({
          symbol: args.symbol,
          buyLeverage: String(fallbackLeverage),
          sellLeverage: String(fallbackLeverage),
        });
        this.logger.log({
          ts: args.nowMs,
          type: "DEMO_LEVERAGE_CLAMP",
          symbol: args.symbol,
          payload: { desiredLeverage, appliedLeverage: fallbackLeverage, maxLeverage },
        });
        this.leverageSet.add(args.symbol);
        return true;
      } catch (retryErr: any) {
        this.onTickRestError(args, "setLeverageFallback", retryErr, st);
        return false;
      }
    }
  }

  start() {
    if (this.reconcileTimer) return;
    void this.reconcile();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, 1500);
    if (!this.executionsTimer) {
      this.executionsTimer = setInterval(() => {
        void this.pollExecutions();
      }, 5000);
    }
    this.startBalancePolling();
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
    this.stopBalancePolling();
  }

  getStats(): DemoStats {
    let pendingEntries = 0;
    for (const st of this.map.values()) {
      if (st.pendingEntry) pendingEntries += 1;
    }
    return {
      mode: "demo",
      openPositions: this.globalOpenPositionsCount,
      openOrders: this.globalOpenOrdersCount,
      globalOpenPositions: this.globalOpenPositionsCount,
      globalOpenOrders: this.globalOpenOrdersCount,
      trackedOpenPositions: this.trackedOpenPositionsCount,
      trackedOpenOrders: this.trackedOpenOrdersCount,
      pendingEntries,
      lastReconcileAtMs: this.lastReconcileAtMs,
      tradesCount: this.demoTradesCount,
      realizedPnlUsdt: this.demoRealizedPnlUsdt,
      feesUsdt: this.demoFeesUsdt,
      lastExecTimeMs: this.lastExecTimeMs,
      currentBalanceUsdt: this.currentBalanceUsdt,
      currentBalanceUpdatedAtMs: this.currentBalanceUpdatedAtMs,
    };
  }

  getCurrentBalance(): { currentBalanceUsdt: number | null; currentBalanceUpdatedAtMs: number | null } {
    return {
      currentBalanceUsdt: this.currentBalanceUsdt,
      currentBalanceUpdatedAtMs: this.currentBalanceUpdatedAtMs,
    };
  }

  private startBalancePolling() {
    if (this.balancePollTimer) return;
    const poll = async () => {
      try {
        const balance = await this.getWalletUsdtBalance();
        this.currentBalanceUsdt = balance;
        this.currentBalanceUpdatedAtMs = Date.now();
      } catch {
      }
    };
    void poll();
    this.balancePollTimer = setInterval(() => {
      void poll();
    }, 60_000);
  }

  private stopBalancePolling() {
    if (!this.balancePollTimer) return;
    clearInterval(this.balancePollTimer);
    this.balancePollTimer = null;
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

        const closedPnl = this.parseNumber(exec.closedPnl);
        const execFee = this.parseNumber(exec.execFee);
        this.demoTradesCount += 1;
        this.demoRealizedPnlUsdt += closedPnl;
        this.demoFeesUsdt += execFee;
        const execTimeMs = Number(exec.execTime ?? 0);
        const ts = Number.isFinite(execTimeMs) && execTimeMs > 0 ? execTimeMs : nowMs;
        if (Number.isFinite(execTimeMs) && execTimeMs > 0) {
          this.lastExecTimeMs = this.lastExecTimeMs == null ? execTimeMs : Math.max(this.lastExecTimeMs, execTimeMs);
        }
        this.logger.log({
          ts,
          type: "DEMO_EXECUTION",
          symbol: String(exec.symbol ?? ""),
          payload: {
            execId,
            orderId: String(exec.orderId ?? ""),
            side: String(exec.side ?? "").toUpperCase(),
            execPrice: this.parseNumber(exec.orderPrice),
            execQty: this.parseNumber(exec.execQty),
            execFee,
            closedPnl,
            realizedPnl: closedPnl,
          },
        });
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

    if (st.executionState !== "FLAT") {
      this.logger.log({
        ts: args.nowMs,
        type: "ORDER_SKIPPED",
        symbol: args.symbol,
        payload: { reason: "symbol_not_flat", signal: args.signal, executionState: st.executionState },
      });
      return;
    }
    if (!st.positionOpen && !st.pendingEntry && this.openOrderSymbolsCache.has(args.symbol)) {
      this.logger.log({
        ts: args.nowMs,
        type: "DEMO_ENTRY_SKIP_OPEN_ORDERS",
        symbol: args.symbol,
        payload: { reason: "server_has_open_orders" },
      });
      st.cooldownUntil = args.nowMs + 2000;
      return;
    }

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

    const leverageReady = await this.ensureLeverageConfigured(args, st);
    if (!leverageReady) return;

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
    const orderLinkId = `${this.runId}:${args.symbol}:${st.entryAttempt + 1}`;

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
    st.entryAttempt += 1;
    st.executionState = "OPENING";
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
      const openOrdersAll = Array.isArray(openOrdersResp.list) ? openOrdersResp.list : [];
      const openOrders = openOrdersAll.filter((o) => universeSymbols.has(String(o.symbol ?? "")));
      const positionsAll = Array.isArray(positionsResp.list) ? positionsResp.list : [];
      const activePositionsAll = positionsAll.filter((p) => Number(p.size ?? "0") !== 0);
      const positions = activePositionsAll.filter((p) => universeSymbols.has(String(p.symbol ?? "")));

      this.lastReconcileAtMs = nowMs;
      this.globalOpenOrdersCount = openOrdersAll.length;
      this.globalOpenPositionsCount = activePositionsAll.length;
      this.trackedOpenOrdersCount = openOrders.length;
      this.trackedOpenPositionsCount = positions.length;
      this.openOrdersCache = openOrders
        .map((o) => ({ symbol: String(o.symbol ?? ""), orderLinkId: String(o.orderLinkId ?? "") }))
        .filter((o) => o.symbol.length > 0 && o.orderLinkId.length > 0);
      this.openOrderSymbolsCache = new Set(
        openOrders.map((o) => String((o as any).symbol ?? "")).filter((s) => s.length > 0)
      );

      const positionBySymbol = new Map(positions.map((p) => [String(p.symbol ?? ""), p]));

      for (const [symbol, st] of this.map.entries()) {
        const hasOpenOrder = st.pendingOrderLinkId
          ? openOrders.some((o) => String(o.orderLinkId ?? "") === st.pendingOrderLinkId && String(o.symbol ?? "") === symbol)
          : false;
        const serverPos = positionBySymbol.get(symbol);

        if (st.pendingEntry && !hasOpenOrder && serverPos) {
          st.positionOpen = true;
          st.executionState = "OPEN";
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
          st.executionState = "FLAT";
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
        st.executionState = "OPEN";
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
