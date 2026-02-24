import { randomUUID } from "node:crypto";
import type { EventLogger } from "../logging/EventLogger.js";

export type PaperSide = "LONG" | "SHORT";

export type PaperBrokerConfig = {
    enabled: boolean;
    longOnly: boolean;

    marginUSDT: number;
    leverage: number;

    entryOffsetPct: number;
    entryTimeoutSec: number;

    tpRoiPct: number;
    slRoiPct: number;

    makerFeeRate: number;
    applyFunding: boolean;

    rearmDelayMs: number;
};

type EntryOrder = {
    id: string;
    symbol: string;
    side: PaperSide;
    entryPrice: number;
    qty: number;
    placedAt: number;
    expiresAt: number;
};

type Position = {
    id: string;
    symbol: string;
    side: PaperSide;
    entryPrice: number;
    qty: number;

    tpPrice: number;
    slPrice: number;

    openedAt: number;

    realizedPnl: number;
    feesPaid: number;
    fundingAccrued: number;

    lastFundingAppliedForNextFundingTime: number | null;
};

type SymbolState = {
    order: EntryOrder | null;
    position: Position | null;
    cooldownUntil: number;
    totalRealizedPnl: number;
};

export type PaperView = {
    paperStatus: "IDLE" | "ENTRY_PENDING" | "OPEN";
    paperSide: PaperSide | null;

    paperEntryPrice: number | null;
    paperTpPrice: number | null;
    paperSlPrice: number | null;
    paperQty: number | null;

    paperOrderExpiresAt: number | null;

    paperUnrealizedPnl: number | null;
    paperRealizedPnl: number;
};

export type PaperStats = {
    openPositions: number;
    pendingOrders: number;

    closedTrades: number;
    wins: number;
    losses: number;

    netRealized: number;
    feesPaid: number;
    fundingAccrued: number;
};

function clampPositive(n: number, fallback: number) {
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function calcTpSl(entry: number, side: PaperSide, leverage: number, tpRoiPct: number, slRoiPct: number) {
    const tpMove = (tpRoiPct / 100) / leverage;
    const slMove = (slRoiPct / 100) / leverage;

    if (side === "LONG") {
        return { tp: entry * (1 + tpMove), sl: entry * (1 - slMove) };
    }
    return { tp: entry * (1 - tpMove), sl: entry * (1 + slMove) };
}

function fee(notional: number, rate: number) {
    return notional * rate;
}

export class PaperBroker {
    private readonly cfg: PaperBrokerConfig;
    private readonly logger: EventLogger;
    private readonly map = new Map<string, SymbolState>();

    private closedTrades = 0;
    private wins = 0;
    private losses = 0;

    private netRealized = 0;
    private feesPaid = 0;
    private fundingAccrued = 0;

    constructor(cfg: PaperBrokerConfig, logger: EventLogger) {
        this.cfg = cfg;
        this.logger = logger;
    }

    getStats(): PaperStats {
        let openPositions = 0;
        let pendingOrders = 0;

        for (const st of this.map.values()) {
            if (st.position) openPositions += 1;
            if (st.order) pendingOrders += 1;
        }

        return {
            openPositions,
            pendingOrders,
            closedTrades: this.closedTrades,
            wins: this.wins,
            losses: this.losses,
            netRealized: this.netRealized,
            feesPaid: this.feesPaid,
            fundingAccrued: this.fundingAccrued,
        };
    }

    getView(symbol: string, markPrice: number | null): PaperView {
        const st = this.map.get(symbol) ?? {
            order: null,
            position: null,
            cooldownUntil: 0,
            totalRealizedPnl: 0
        };

        if (!this.cfg.enabled) {
            return {
                paperStatus: "IDLE",
                paperSide: null,
                paperEntryPrice: null,
                paperTpPrice: null,
                paperSlPrice: null,
                paperQty: null,
                paperOrderExpiresAt: null,
                paperUnrealizedPnl: null,
                paperRealizedPnl: st.totalRealizedPnl
            };
        }

        if (st.position) {
            const p = st.position;
            const unreal =
                markPrice == null
                    ? null
                    : p.side === "LONG"
                        ? (markPrice - p.entryPrice) * p.qty
                        : (p.entryPrice - markPrice) * p.qty;

            return {
                paperStatus: "OPEN",
                paperSide: p.side,
                paperEntryPrice: p.entryPrice,
                paperTpPrice: p.tpPrice,
                paperSlPrice: p.slPrice,
                paperQty: p.qty,
                paperOrderExpiresAt: null,
                paperUnrealizedPnl: unreal,
                paperRealizedPnl: st.totalRealizedPnl
            };
        }

        if (st.order) {
            const o = st.order;
            return {
                paperStatus: "ENTRY_PENDING",
                paperSide: o.side,
                paperEntryPrice: o.entryPrice,
                paperTpPrice: null,
                paperSlPrice: null,
                paperQty: o.qty,
                paperOrderExpiresAt: o.expiresAt,
                paperUnrealizedPnl: null,
                paperRealizedPnl: st.totalRealizedPnl
            };
        }

        return {
            paperStatus: "IDLE",
            paperSide: null,
            paperEntryPrice: null,
            paperTpPrice: null,
            paperSlPrice: null,
            paperQty: null,
            paperOrderExpiresAt: null,
            paperUnrealizedPnl: null,
            paperRealizedPnl: st.totalRealizedPnl
        };
    }

    stopAll(args: {
        nowMs: number;
        symbols: string[];
        getMarkPrice: (symbol: string) => number | null;
    }) {
        const { nowMs, symbols, getMarkPrice } = args;

        // отменяем все ордера и закрываем все позиции
        const allSymbols = new Set<string>([...symbols, ...this.map.keys()]);

        for (const symbol of allSymbols) {
            const st = this.map.get(symbol) ?? {
                order: null,
                position: null,
                cooldownUntil: 0,
                totalRealizedPnl: 0
            };

            if (st.order) {
                this.logger.log({
                    ts: nowMs,
                    type: "ORDER_CANCELED",
                    symbol,
                    payload: {
                        orderId: st.order.id,
                        side: st.order.side,
                        entryPrice: st.order.entryPrice,
                        qty: st.order.qty
                    }
                });
                st.order = null;
            }

            if (st.position) {
                const p = st.position;
                const mark = getMarkPrice(symbol);
                const closePrice = Number.isFinite(mark as number) ? (mark as number) : p.entryPrice;

                const notionalExit = closePrice * p.qty;
                const exitFee = fee(notionalExit, this.cfg.makerFeeRate);

                let pnlFromMove = 0;
                if (p.side === "LONG") pnlFromMove = (closePrice - p.entryPrice) * p.qty;
                else pnlFromMove = (p.entryPrice - closePrice) * p.qty;

                p.feesPaid += exitFee;
                p.realizedPnl += pnlFromMove;
                p.realizedPnl -= exitFee;

                st.totalRealizedPnl += p.realizedPnl;

                this.logger.log({
                    ts: nowMs,
                    type: "POSITION_FORCE_CLOSE",
                    symbol,
                    payload: {
                        side: p.side,
                        entryPrice: p.entryPrice,
                        closePrice,
                        qty: p.qty,
                        pnlFromMove,
                        fundingAccrued: p.fundingAccrued,
                        feesPaid: p.feesPaid,
                        realizedPnl: p.realizedPnl
                    }
                });


                this.closedTrades += 1;
                this.netRealized += p.realizedPnl;
                this.feesPaid += p.feesPaid;
                this.fundingAccrued += p.fundingAccrued;

                st.position = null;
            }

            st.cooldownUntil = nowMs + this.cfg.rearmDelayMs;
            this.map.set(symbol, st);
        }

        this.logger.log({ ts: nowMs, type: "SESSION_STOP", payload: { symbols: Array.from(allSymbols) } });
    }

    tick(input: {
        symbol: string;
        nowMs: number;

        markPrice: number;
        fundingRate: number;
        nextFundingTime: number;

        signal: PaperSide | null;
        signalReason: string;
        cooldownActive: boolean;
    }) {
        if (!this.cfg.enabled) return;

        const { symbol, nowMs, markPrice, fundingRate, nextFundingTime, signal, signalReason, cooldownActive } = input;

        const st = this.map.get(symbol) ?? {
            order: null,
            position: null,
            cooldownUntil: 0,
            totalRealizedPnl: 0
        };

        // 1) Position management
        if (st.position) {
            const p = st.position;

            // funding at funding time (apply once per nextFundingTime value)
            if (this.cfg.applyFunding) {
                const shouldApply =
                    Number.isFinite(nextFundingTime) &&
                    nowMs >= nextFundingTime &&
                    p.lastFundingAppliedForNextFundingTime !== nextFundingTime;

                if (shouldApply) {
                    const notional = markPrice * p.qty;
                    const payment = p.side === "LONG" ? -notional * fundingRate : notional * fundingRate;

                    p.fundingAccrued += payment;
                    p.realizedPnl += payment;
                    p.lastFundingAppliedForNextFundingTime = nextFundingTime;

                    this.logger.log({
                        ts: nowMs,
                        type: "FUNDING_APPLIED",
                        symbol,
                        payload: { side: p.side, fundingRate, notional, payment, nextFundingTime }
                    });
                }
            }

            // TP/SL check
            let closeType: "TP" | "SL" | null = null;
            let closePrice: number | null = null;

            if (p.side === "LONG") {
                if (markPrice >= p.tpPrice) {
                    closeType = "TP";
                    closePrice = p.tpPrice;
                } else if (markPrice <= p.slPrice) {
                    closeType = "SL";
                    closePrice = p.slPrice;
                }
            } else {
                if (markPrice <= p.tpPrice) {
                    closeType = "TP";
                    closePrice = p.tpPrice;
                } else if (markPrice >= p.slPrice) {
                    closeType = "SL";
                    closePrice = p.slPrice;
                }
            }

            if (closeType && closePrice != null) {
                const notionalExit = closePrice * p.qty;
                const exitFee = fee(notionalExit, this.cfg.makerFeeRate);

                let pnlFromMove = 0;
                if (p.side === "LONG") pnlFromMove = (closePrice - p.entryPrice) * p.qty;
                else pnlFromMove = (p.entryPrice - closePrice) * p.qty;

                p.feesPaid += exitFee;
                p.realizedPnl += pnlFromMove;
                p.realizedPnl -= exitFee;

                st.totalRealizedPnl += p.realizedPnl;

                this.logger.log({
                    ts: nowMs,
                    type: closeType === "TP" ? "POSITION_CLOSE_TP" : "POSITION_CLOSE_SL",
                    symbol,
                    payload: {
                        side: p.side,
                        entryPrice: p.entryPrice,
                        closePrice,
                        qty: p.qty,
                        pnlFromMove,
                        fundingAccrued: p.fundingAccrued,
                        feesPaid: p.feesPaid,
                        realizedPnl: p.realizedPnl
                    }
                });


                this.closedTrades += 1;
                if (closeType === "TP") this.wins += 1;
                else this.losses += 1;

                this.netRealized += p.realizedPnl;
                this.feesPaid += p.feesPaid;
                this.fundingAccrued += p.fundingAccrued;

                st.position = null;
                st.cooldownUntil = nowMs + this.cfg.rearmDelayMs;
            }

            this.map.set(symbol, st);
            return;
        }

        // 2) Order management
        if (st.order) {
            const o = st.order;

            if (nowMs >= o.expiresAt) {
                this.logger.log({
                    ts: nowMs,
                    type: "ORDER_EXPIRED",
                    symbol,
                    payload: { orderId: o.id, side: o.side, entryPrice: o.entryPrice, qty: o.qty }
                });

                st.order = null;
                st.cooldownUntil = nowMs + this.cfg.rearmDelayMs;
                this.map.set(symbol, st);
                return;
            }

            const filled = o.side === "LONG" ? markPrice <= o.entryPrice : markPrice >= o.entryPrice;

            if (filled) {
                const notionalEntry = o.entryPrice * o.qty;
                const entryFee = fee(notionalEntry, this.cfg.makerFeeRate);

                const { tp, sl } = calcTpSl(o.entryPrice, o.side, this.cfg.leverage, this.cfg.tpRoiPct, this.cfg.slRoiPct);

                const pos: Position = {
                    id: randomUUID(),
                    symbol,
                    side: o.side,
                    entryPrice: o.entryPrice,
                    qty: o.qty,
                    tpPrice: tp,
                    slPrice: sl,
                    openedAt: nowMs,
                    realizedPnl: 0,
                    feesPaid: entryFee,
                    fundingAccrued: 0,
                    lastFundingAppliedForNextFundingTime: null
                };

                pos.realizedPnl -= entryFee;

                this.logger.log({
                    ts: nowMs,
                    type: "ORDER_FILLED",
                    symbol,
                    payload: { orderId: o.id, side: o.side, entryPrice: o.entryPrice, qty: o.qty, fee: entryFee }
                });

                this.logger.log({
                    ts: nowMs,
                    type: "POSITION_OPEN",
                    symbol,
                    payload: { positionId: pos.id, side: pos.side, entryPrice: pos.entryPrice, qty: pos.qty, tpPrice: pos.tpPrice, slPrice: pos.slPrice }
                });

                st.order = null;
                st.position = pos;
                this.map.set(symbol, st);
                return;
            }

            this.map.set(symbol, st);
            return;
        }

        // 3) Place new entry order (if allowed)
        if (nowMs < st.cooldownUntil) {
            this.map.set(symbol, st);
            return;
        }

        if (cooldownActive) {
            this.map.set(symbol, st);
            return;
        }

        if (!signal) {
            this.map.set(symbol, st);
            return;
        }

        if (this.cfg.longOnly && signal === "SHORT") {
            this.logger.log({
                ts: nowMs,
                type: "ORDER_SKIPPED",
                symbol,
                payload: { reason: "long_only", signal }
            });
            this.map.set(symbol, st);
            return;
        }

        const margin = clampPositive(this.cfg.marginUSDT, 10);
        const lev = clampPositive(this.cfg.leverage, 5);
        const notional = margin * lev;

        const offset = Math.abs(this.cfg.entryOffsetPct) / 100;
        const entryPrice = signal === "LONG" ? markPrice * (1 - offset) : markPrice * (1 + offset);
        const qty = notional / entryPrice;

        const order: EntryOrder = {
            id: randomUUID(),
            symbol,
            side: signal,
            entryPrice,
            qty,
            placedAt: nowMs,
            expiresAt: nowMs + Math.max(1, this.cfg.entryTimeoutSec) * 1000
        };

        st.order = order;

        this.logger.log({
            ts: nowMs,
            type: "SIGNAL_ACCEPTED",
            symbol,
            payload: { signal, signalReason, markPrice, fundingRate, nextFundingTime, entryOffsetPct: this.cfg.entryOffsetPct }
        });

        this.logger.log({
            ts: nowMs,
            type: "ORDER_PLACED",
            symbol,
            payload: { orderId: order.id, side: order.side, entryPrice: order.entryPrice, qty: order.qty, expiresAt: order.expiresAt }
        });

        this.map.set(symbol, st);
    }
}