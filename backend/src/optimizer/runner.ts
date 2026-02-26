import fs from "node:fs";
import { BybitMarketCache } from "../engine/BybitMarketCache.js";
import { CandleTracker } from "../engine/CandleTracker.js";
import { FundingCooldownGate } from "../engine/FundingCooldownGate.js";
import { SignalEngine } from "../engine/SignalEngine.js";
import { PaperBroker } from "../paper/PaperBroker.js";
import { configStore } from "../runtime/configStore.js";
import { getTapePath, safeId } from "./tapeStore.js";

type TapeMeta = {
  tapeId?: string;
  createdAt?: number;
  sessionId?: string | null;
  universeSelectedId?: string;
  klineTfMin?: number;
  symbols?: string[];
};

type TapeEvent =
  | { type: "ticker"; ts: number; symbol: string; payload: any }
  | { type: "kline_confirm"; ts: number; symbol: string; payload: any };

type RandomizedParams = {
  priceThresholdPct: number;
  oivThresholdPct: number;
  entryOffsetPct: number;
  tpRoiPct: number;
  slRoiPct: number;
};

export type OptimizerResult = {
  netPnl: number;
  trades: number;
  winRatePct: number;
  params: RandomizedParams;
};

export type OptimizerParamKey = "priceTh" | "oivTh" | "tp" | "sl" | "offset";
export type OptimizerPrecision = Record<OptimizerParamKey, number>;
export type OptimizerSortKey = "netPnl" | "trades" | "winRatePct" | OptimizerParamKey;
export type OptimizerSortDir = "asc" | "desc";

type OptimizerRangeBound = { min: number; max: number };

export type OptimizerRanges = Partial<{
  priceTh: OptimizerRangeBound;
  oivTh: OptimizerRangeBound;
  tp: OptimizerRangeBound;
  sl: OptimizerRangeBound;
  offset: OptimizerRangeBound;
}>;

function pctChange(now: number, ref: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(ref) || ref === 0) return null;
  return ((now - ref) / ref) * 100;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildRng(seed: number) {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pickRange(rnd: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + rnd() * (max - min);
}

function quantize(value: number, step = 0.001): number {
  return Math.round(value / step) * step;
}

function quantizeAndClamp(value: number, min: number, max: number, precision = 3): number {
  const step = 10 ** (-precision);
  const quantized = quantize(value, step);
  const clamped = Math.min(max, Math.max(min, quantized));
  const fixed = Number(clamped.toFixed(precision));
  return Math.min(max, Math.max(min, fixed));
}

export const DEFAULT_OPTIMIZER_PRECISION: OptimizerPrecision = {
  priceTh: 3,
  oivTh: 3,
  tp: 3,
  sl: 3,
  offset: 3,
};

function withDefaultPrecision(precision?: Partial<OptimizerPrecision>): OptimizerPrecision {
  return {
    priceTh: precision?.priceTh ?? DEFAULT_OPTIMIZER_PRECISION.priceTh,
    oivTh: precision?.oivTh ?? DEFAULT_OPTIMIZER_PRECISION.oivTh,
    tp: precision?.tp ?? DEFAULT_OPTIMIZER_PRECISION.tp,
    sl: precision?.sl ?? DEFAULT_OPTIMIZER_PRECISION.sl,
    offset: precision?.offset ?? DEFAULT_OPTIMIZER_PRECISION.offset,
  };
}

function readRange(bound: { min?: unknown; max?: unknown } | undefined, fallbackMin: number, fallbackMax: number) {
  const min = toFiniteNumber(bound?.min, fallbackMin);
  const max = toFiniteNumber(bound?.max, fallbackMax);
  if (max < min) return { min: max, max: min };
  return { min, max };
}

export function readTapeLines(tapePath: string): { meta: TapeMeta | null; events: TapeEvent[]; firstTsMs: number | null; lastTsMs: number | null } {
  const raw = fs.readFileSync(tapePath, "utf8");
  const lines = raw.split(/\r?\n/);

  let meta: TapeMeta | null = null;
  const events: TapeEvent[] = [];
  let firstTsMs: number | null = null;
  let lastTsMs: number | null = null;

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;

    try {
      const row = JSON.parse(text) as any;
      if (row?.type === "meta" && meta == null && row.payload && typeof row.payload === "object") {
        meta = row.payload as TapeMeta;
        continue;
      }
      if (row?.type === "ticker" && typeof row?.symbol === "string") {
        const tsRaw = Number(row.ts) || 0;
        const tsMs = tsRaw > 0 && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
        if (tsMs > 0) {
          if (firstTsMs == null || tsMs < firstTsMs) firstTsMs = tsMs;
          if (lastTsMs == null || tsMs > lastTsMs) lastTsMs = tsMs;
        }
        events.push({
          type: "ticker",
          ts: tsRaw,
          symbol: row.symbol,
          payload: row.payload ?? {},
        });
        continue;
      }
      if (row?.type === "kline_confirm" && typeof row?.symbol === "string") {
        events.push({
          type: "kline_confirm",
          ts: Number(row.ts) || 0,
          symbol: row.symbol,
          payload: row.payload ?? {},
        });
      }
    } catch {
      // ignore
    }
  }

  return { meta, events, firstTsMs, lastTsMs };
}

export function sortOptimizationResults(results: OptimizerResult[], key: OptimizerSortKey, dir: OptimizerSortDir): OptimizerResult[] {
  const direction = dir === "asc" ? 1 : -1;
  const toComparable = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const readValue = (result: OptimizerResult): number => {
    if (key === "priceTh") return result.params.priceThresholdPct;
    if (key === "oivTh") return result.params.oivThresholdPct;
    if (key === "tp") return result.params.tpRoiPct;
    if (key === "sl") return result.params.slRoiPct;
    if (key === "offset") return result.params.entryOffsetPct;
    return toComparable(result[key]);
  };
  const compareDesc = (left: number, right: number) => right - left;
  return [...results].sort((a, b) => {
    if (key !== "trades") {
      const aNoTrades = (a.trades ?? 0) === 0;
      const bNoTrades = (b.trades ?? 0) === 0;
      if (aNoTrades !== bNoTrades) return aNoTrades ? 1 : -1;
    }

    const primaryDiff = (readValue(a) - readValue(b)) * direction;
    if (primaryDiff !== 0) return primaryDiff;

    const netPnlDiff = compareDesc(a.netPnl ?? 0, b.netPnl ?? 0);
    if (netPnlDiff !== 0) return netPnlDiff;

    const tradesDiff = compareDesc(a.trades ?? 0, b.trades ?? 0);
    if (tradesDiff !== 0) return tradesDiff;

    return compareDesc(a.winRatePct ?? 0, b.winRatePct ?? 0);
  });
}

function generateCandidate(
  rnd: () => number,
  ranges: OptimizerRanges | undefined,
  base: ReturnType<typeof configStore.get>,
  precision: OptimizerPrecision
): RandomizedParams {
  const price = readRange(ranges?.priceTh, 0.1, Math.max(0.1, base.signals.priceThresholdPct * 3 || 1));
  const oiv = readRange(ranges?.oivTh, 0.1, Math.max(0.1, base.signals.oivThresholdPct * 3 || 1));
  const offset = readRange(ranges?.offset, 0, Math.max(0.01, base.paper.entryOffsetPct * 3 || 0.5));
  const tp = readRange(ranges?.tp, 1.5, Math.max(1.5, base.paper.tpRoiPct * 3 || 6));
  const sl = readRange(ranges?.sl, 1.5, Math.max(1.5, base.paper.slRoiPct * 3 || 6));

  return {
    priceThresholdPct: quantizeAndClamp(pickRange(rnd, price.min, price.max), price.min, price.max, precision.priceTh),
    oivThresholdPct: quantizeAndClamp(pickRange(rnd, oiv.min, oiv.max), oiv.min, oiv.max, precision.oivTh),
    entryOffsetPct: quantizeAndClamp(pickRange(rnd, offset.min, offset.max), offset.min, offset.max, precision.offset),
    tpRoiPct: quantizeAndClamp(pickRange(rnd, tp.min, tp.max), tp.min, tp.max, precision.tp),
    slRoiPct: quantizeAndClamp(pickRange(rnd, sl.min, sl.max), sl.min, sl.max, precision.sl),
  };
}

export async function runOptimization(args: {
  tapeId?: string;
  tapeIds?: string[];
  candidates: number;
  seed: number;
  ranges?: OptimizerRanges;
  precision?: Partial<OptimizerPrecision>;
  optTfMin?: number;
  onProgress?: (done: number, total: number, partialResults: OptimizerResult[]) => void;
  shouldStop?: () => boolean;
  directionMode?: "both" | "long" | "short";
}): Promise<{
  tapeIds: string[];
  metaByTapeId: Record<string, TapeMeta | null>;
  results: OptimizerResult[];
  cancelled: boolean;
  diagnostics?: {
    decisionsNoRefs: number;
    decisionsOk: number;
    effectiveTfMinByTapeId: Record<string, number>;
    durationMinByTapeId: Record<string, number>;
  };
}> {
  const requestedTapeIds = (args.tapeIds && args.tapeIds.length ? args.tapeIds : [args.tapeId]).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  const tapeIds = requestedTapeIds.map((id) => safeId(id));
  const tapes = tapeIds.map((id) => {
    const tapePath = getTapePath(id);
    const parsed = readTapeLines(tapePath);
    return { tapeId: id, meta: parsed.meta, events: parsed.events, firstTsMs: parsed.firstTsMs, lastTsMs: parsed.lastTsMs };
  });

  const baseConfig = configStore.get();
  const precision = withDefaultPrecision(args.precision);
  const rnd = buildRng(args.seed);
  const results: OptimizerResult[] = [];

  let lastPctLocal = 0;
  let cancelled = false;
  let decisionsNoRefs = 0;
  let decisionsOk = 0;
  const effectiveTfMinByTapeId: Record<string, number> = {};
  const durationMinByTapeId: Record<string, number> = {};

  for (let i = 0; i < args.candidates; i += 1) {
    if (args.shouldStop?.()) {
      cancelled = true;
      break;
    }
    const params = generateCandidate(rnd, args.ranges, baseConfig, precision);
    const candidateConfig = {
      signals: {
        priceThresholdPct: params.priceThresholdPct,
        oivThresholdPct: params.oivThresholdPct,
        requireFundingSign: baseConfig.signals.requireFundingSign,
      },
      paper: {
        enabled: baseConfig.paper.enabled,
        directionMode: args.directionMode ?? baseConfig.paper.directionMode,
        marginUSDT: baseConfig.paper.marginUSDT,
        leverage: baseConfig.paper.leverage,
        entryOffsetPct: params.entryOffsetPct,
        entryTimeoutSec: Math.max(baseConfig.paper.entryTimeoutSec, 15),
        tpRoiPct: params.tpRoiPct,
        slRoiPct: params.slRoiPct,
        makerFeeRate: baseConfig.paper.makerFeeRate,
        applyFunding: baseConfig.paper.applyFunding,
        rearmDelayMs: baseConfig.paper.rearmDelayMs,
      },
      fundingCooldown: baseConfig.fundingCooldown,
    };

    let netPnlTotal = 0;
    let tradesTotal = 0;
    let winsTotal = 0;

    for (const tape of tapes) {
      const cache = new BybitMarketCache();
      const candles = new CandleTracker(cache);
      const fundingGate = new FundingCooldownGate(candidateConfig.fundingCooldown.beforeMin, candidateConfig.fundingCooldown.afterMin);
      const signalEngine = new SignalEngine({
        priceThresholdPct: candidateConfig.signals.priceThresholdPct,
        oivThresholdPct: candidateConfig.signals.oivThresholdPct,
        requireFundingSign: candidateConfig.signals.requireFundingSign,
        directionMode: candidateConfig.paper.directionMode,
      });

      const logger = {
        sessionId: `optimizer-${tape.tapeId}`,
        filePath: "",
        log(_ev: any) {
          return;
        },
      };

      const paper = new PaperBroker(candidateConfig.paper, logger as any);
      let lastEventTs = 0;
      const tfMinRaw = Number(args.optTfMin ?? tape.meta?.klineTfMin ?? baseConfig.universe.klineTfMin);
      const tfMinFromMeta = Number.isFinite(tfMinRaw) && tfMinRaw > 0 ? Math.floor(tfMinRaw) : baseConfig.universe.klineTfMin;
      const durationMs = Math.max(0, (tape.lastTsMs ?? 0) - (tape.firstTsMs ?? 0));
      const durationMin = durationMs / 60_000;
      let effectiveTfMin = tfMinFromMeta;
      if (durationMin > 0 && durationMin < tfMinFromMeta) {
        effectiveTfMin = Math.max(1, Math.floor(durationMin));
      }
      const tfMs = effectiveTfMin * 60_000;
      effectiveTfMinByTapeId[tape.tapeId] = effectiveTfMin;
      durationMinByTapeId[tape.tapeId] = durationMin;
      const fallbackBySymbol = new Map<string, {
        lastBucketId: number | undefined;
        lastPriceInBucket: number | null;
        lastOivInBucket: number | null;
        prevCandleClose: number | null;
        prevCandleOivClose: number | null;
      }>();

      let eventCounter = 0;
      for (const event of tape.events) {
        const tsRaw = Number(event.ts) || 0;
        const ts = tsRaw > 0 && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
        if (ts > lastEventTs) lastEventTs = ts;
        eventCounter += 1;
        if (eventCounter % 5000 === 0) {
          if (args.shouldStop?.()) {
            cancelled = true;
            break;
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        if (event.type === "ticker") {
          cache.upsertFromTicker(event.symbol, event.payload ?? {});

          const row = cache.getRawRow(event.symbol);
          const markPrice = Number(row?.markPrice ?? 0);
          const openInterestValue = Number(row?.openInterestValue ?? 0);
          const fundingRate = Number(row?.fundingRate ?? 0);
          const nextFundingTime = Number(row?.nextFundingTime ?? 0);

          const refs = candles.getRefs(event.symbol);
          const useTrackerRefs = args.optTfMin == null;

          const bucketId = Math.floor(ts / tfMs);
          const fallbackState = fallbackBySymbol.get(event.symbol) ?? {
            lastBucketId: undefined,
            lastPriceInBucket: null,
            lastOivInBucket: null,
            prevCandleClose: null,
            prevCandleOivClose: null,
          };

          if (fallbackState.lastBucketId === undefined) {
            fallbackState.lastBucketId = bucketId;
          } else if (fallbackState.lastBucketId !== bucketId) {
            fallbackState.prevCandleClose = fallbackState.lastPriceInBucket;
            fallbackState.prevCandleOivClose = fallbackState.lastOivInBucket;
            fallbackState.lastBucketId = bucketId;
            fallbackState.lastPriceInBucket = null;
            fallbackState.lastOivInBucket = null;
          }

          if (Number.isFinite(markPrice) && markPrice > 0) fallbackState.lastPriceInBucket = markPrice;
          if (Number.isFinite(openInterestValue) && openInterestValue > 0) fallbackState.lastOivInBucket = openInterestValue;
          fallbackBySymbol.set(event.symbol, fallbackState);

          const priceRef = useTrackerRefs ? (refs.prevCandleClose ?? fallbackState.prevCandleClose) : fallbackState.prevCandleClose;
          const oivRef = useTrackerRefs ? (refs.prevCandleOivClose ?? fallbackState.prevCandleOivClose) : fallbackState.prevCandleOivClose;
          const priceMovePct = priceRef == null || markPrice <= 0 ? null : pctChange(markPrice, priceRef);
          const oivMovePct = oivRef == null || openInterestValue <= 0 ? null : pctChange(openInterestValue, oivRef);

          const cooldownState = fundingGate.state(nextFundingTime || null, ts);
          const decision = signalEngine.decide({
            priceMovePct,
            oivMovePct,
            fundingRate,
            cooldownActive: cooldownState?.active ?? false,
          });
          if (decision.reason === "no_refs") decisionsNoRefs += 1;
          if (decision.reason === "ok_long" || decision.reason === "ok_short") decisionsOk += 1;

          paper.tick({
            symbol: event.symbol,
            nowMs: ts,
            markPrice,
            fundingRate,
            nextFundingTime,
            signal: decision.signal,
            signalReason: decision.reason,
            cooldownActive: cooldownState?.active ?? false,
          });
        }

        if (event.type === "kline_confirm") {
          candles.ingestKline(event.symbol, { confirm: true, close: event.payload?.close });
        }
      }

      if (cancelled) break;

      const symbols = Array.isArray(tape.meta?.symbols) ? tape.meta.symbols : [];
      paper.stopAll({
        nowMs: lastEventTs || 0,
        symbols,
        getMarkPrice: (symbol: string) => cache.getMarkPrice(symbol),
      });

      const stats = paper.getStats();
      netPnlTotal += stats.netRealized;
      tradesTotal += stats.closedTrades;
      winsTotal += stats.wins;
    }

    if (cancelled) break;

    const winRatePct = tradesTotal > 0 ? (winsTotal / tradesTotal) * 100 : 0;

    results.push({
      netPnl: netPnlTotal,
      trades: tradesTotal,
      winRatePct,
      params,
    });

    const done = i + 1;
    const pct = args.candidates > 0 ? Math.floor((done / args.candidates) * 100) : 0;
    if (args.onProgress) {
      args.onProgress(done, args.candidates, results);
    }
    if (pct > lastPctLocal) {
      lastPctLocal = pct;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return {
    tapeIds,
    metaByTapeId: Object.fromEntries(tapes.map((t) => [t.tapeId, t.meta])),
    results: sortOptimizationResults(results, "netPnl", "desc"),
    cancelled,
    ...(decisionsOk === 0 && decisionsNoRefs >= 100
      ? {
          diagnostics: {
            decisionsNoRefs,
            decisionsOk,
            effectiveTfMinByTapeId,
            durationMinByTapeId,
          },
        }
      : {}),
  };
}
