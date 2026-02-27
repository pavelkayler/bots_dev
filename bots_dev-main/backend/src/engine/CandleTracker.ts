import { BybitMarketCache } from "./BybitMarketCache.js";

export type CandleRefs = {
    prevCandleClose: number | null;
    prevCandleOivClose: number | null;
    confirmedAt: number | null;
};

/**
 * Tracks candle boundaries using Bybit kline stream.
 *
 * Rule:
 * - When we receive kline with confirm=true, we snapshot:
 *   - prevCandleClose = kline.close
 *   - prevCandleOivClose = last known ticker.openInterestValue at that moment
 */
export class CandleTracker {
    private readonly cache: BybitMarketCache;
    private readonly refs = new Map<string, CandleRefs>();

    constructor(cache: BybitMarketCache) {
        this.cache = cache;
    }

    /**
     * Ingest one kline row for one symbol.
     * Returns updated refs when confirm=true, otherwise null.
     */
    ingestKline(symbol: string, kline: Record<string, any>): CandleRefs | null {
        const confirmRaw = kline?.confirm;
        const isConfirm =
            confirmRaw === true ||
            confirmRaw === "true" ||
            confirmRaw === 1 ||
            confirmRaw === "1";

        if (!isConfirm) return null;

        const closeRaw = kline?.close ?? kline?.c ?? kline?.closePrice ?? null;
        const close = closeRaw == null ? null : Number(closeRaw);

        const oiv = this.cache.getOpenInterestValue(symbol);

        const next: CandleRefs = {
            prevCandleClose: Number.isFinite(close as number) ? (close as number) : null,
            prevCandleOivClose: Number.isFinite(oiv as number) ? (oiv as number) : null,
            confirmedAt: Date.now()
        };

        this.refs.set(symbol, next);
        return next;
    }

    getRefs(symbol: string): CandleRefs {
        return (
            this.refs.get(symbol) ?? {
                prevCandleClose: null,
                prevCandleOivClose: null,
                confirmedAt: null
            }
        );
    }
}