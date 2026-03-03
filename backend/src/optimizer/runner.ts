import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import readline from "node:readline";
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

type TapeParsed = {
  meta: TapeMeta | null;
  events: TapeEvent[];
  firstTsMs: number | null;
  lastTsMs: number | null;
  medianTickIntervalSec: number;
};

type RandomizedParams = {
  priceThresholdPct: number;
  oivThresholdPct: number;
  entryOffsetPct: number;
  tpRoiPct: number;
  slRoiPct: number;
  timeoutSec: number;
  rearmMs: number;
};

export type OptimizerResult = {
  netPnl: number;
  trades: number;
  winRatePct: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdownUsdt: number;
  signalsOk: number;
  decisionsNoRefs: number;
  ordersPlaced: number;
  ordersFilled: number;
  ordersExpired: number;
  closesTp: number;
  closesSl: number;
  closesForce: number;
  params: RandomizedParams;
};

export type OptimizerParamKey = "priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs";
export type OptimizerMetricSortKey =
  | "netPnl"
  | "trades"
  | "winRatePct"
  | "expectancy"
  | "profitFactor"
  | "maxDrawdownUsdt"
  | "ordersPlaced"
  | "ordersFilled"
  | "ordersExpired";
export type OptimizerPrecision = Record<OptimizerParamKey, number>;
export type OptimizerSortKey = OptimizerMetricSortKey | OptimizerParamKey;
export type OptimizerSortDir = "asc" | "desc";

type OptimizerRangeBound = { min: number; max: number };

export type OptimizerRanges = Partial<{
  priceTh: OptimizerRangeBound;
  oivTh: OptimizerRangeBound;
  tp: OptimizerRangeBound;
  sl: OptimizerRangeBound;
  offset: OptimizerRangeBound;
  timeoutSec: OptimizerRangeBound;
  rearmMs: OptimizerRangeBound;
}>;

export type OptimizerSimulationParams = {
  initialBalance?: number;
  marginPerTrade?: number;
  leverage?: number;
  feeBps?: number;
  fundingBpsPer8h?: number;
  slippageBps?: number;
};

type CloseSnapshot = { ts: number; realizedPnl: number };

const MAX_TICK_INTERVAL_SAMPLES = 20_000;
const CACHE_DIR = path.resolve(process.cwd(), "data", "cache", "bybit_klines");

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

function sortNumeric(values: number[]): number[] {
  return values.sort((a, b) => a - b);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = sortNumeric([...values]);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

export const DEFAULT_OPTIMIZER_PRECISION: OptimizerPrecision = {
  priceTh: 3,
  oivTh: 3,
  tp: 3,
  sl: 3,
  offset: 3,
  timeoutSec: 0,
  rearmMs: 0,
};

function withDefaultPrecision(precision?: Partial<OptimizerPrecision>): OptimizerPrecision {
  return {
    priceTh: precision?.priceTh ?? DEFAULT_OPTIMIZER_PRECISION.priceTh,
    oivTh: precision?.oivTh ?? DEFAULT_OPTIMIZER_PRECISION.oivTh,
    tp: precision?.tp ?? DEFAULT_OPTIMIZER_PRECISION.tp,
    sl: precision?.sl ?? DEFAULT_OPTIMIZER_PRECISION.sl,
    offset: precision?.offset ?? DEFAULT_OPTIMIZER_PRECISION.offset,
    timeoutSec: precision?.timeoutSec ?? DEFAULT_OPTIMIZER_PRECISION.timeoutSec,
    rearmMs: precision?.rearmMs ?? DEFAULT_OPTIMIZER_PRECISION.rearmMs,
  };
}

function readRange(bound: { min?: unknown; max?: unknown } | undefined, fallbackMin: number, fallbackMax: number) {
  const min = toFiniteNumber(bound?.min, fallbackMin);
  const max = toFiniteNumber(bound?.max, fallbackMax);
  if (max < min) return { min: max, max: min };
  return { min, max };
}

export async function readTapeLines(
  tapePath: string,
  options?: {
    byteLimit?: number;
    timeRangeFromTs?: number;
    timeRangeToTs?: number;
  },
  hooks?: {
    onProgress?: (bytesRead: number, totalBytes: number) => void;
  }
): Promise<TapeParsed> {
  const statSize = (await fs.promises.stat(tapePath)).size;
  const byteLimit = typeof options?.byteLimit === "number" ? Math.floor(options.byteLimit) : undefined;
  const totalBytes = byteLimit == null ? statSize : Math.max(0, Math.min(statSize, byteLimit));
  if (totalBytes <= 0) {
    hooks?.onProgress?.(0, 0);
    return {
      meta: null,
      events: [],
      firstTsMs: null,
      lastTsMs: null,
      medianTickIntervalSec: 0,
    };
  }
  const stream = fs.createReadStream(
    tapePath,
    byteLimit == null
      ? { encoding: "utf8" }
      : { encoding: "utf8", start: 0, end: Math.max(0, totalBytes - 1) }
  );
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let meta: TapeMeta | null = null;
  const events: TapeEvent[] = [];
  let firstTsMs: number | null = null;
  let lastTsMs: number | null = null;

  const lastTickerTsBySymbol = new Map<string, number>();
  const tickIntervalSamples: number[] = [];
  let lastLoadProgressAt = 0;

  const maybeReportLoadProgress = async () => {
    const now = Date.now();
    if (now - lastLoadProgressAt < 200) return;
    lastLoadProgressAt = now;
    hooks?.onProgress?.(Math.min(stream.bytesRead, totalBytes), totalBytes);
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  hooks?.onProgress?.(0, totalBytes);

  for await (const line of rl) {
    await maybeReportLoadProgress();
    const text = line.trim();
    if (!text) continue;

    let row: any;
    try {
      row = JSON.parse(text);
    } catch {
      continue;
    }

    if (row?.type === "meta" && meta == null && row.payload && typeof row.payload === "object") {
      meta = row.payload as TapeMeta;
      continue;
    }

    if ((row?.type === "ticker" || row?.type === "kline_confirm") && typeof row?.symbol === "string") {
      const tsRaw = Number(row.ts) || 0;
      const tsMs = tsRaw > 0 && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
      if (typeof options?.timeRangeFromTs === "number" && tsMs > 0 && tsMs < options.timeRangeFromTs) continue;
      if (typeof options?.timeRangeToTs === "number" && tsMs > 0 && tsMs > options.timeRangeToTs) continue;
      if (tsMs > 0) {
        if (firstTsMs == null || tsMs < firstTsMs) firstTsMs = tsMs;
        if (lastTsMs == null || tsMs > lastTsMs) lastTsMs = tsMs;
      }

      if (row.type === "ticker" && tsMs > 0) {
        const prevTs = lastTickerTsBySymbol.get(row.symbol);
        if (prevTs != null && tsMs > prevTs && tickIntervalSamples.length < MAX_TICK_INTERVAL_SAMPLES) {
          tickIntervalSamples.push((tsMs - prevTs) / 1000);
        }
        lastTickerTsBySymbol.set(row.symbol, tsMs);
      }

      events.push({
        type: row.type,
        ts: tsRaw,
        symbol: row.symbol,
        payload: row.payload ?? {},
      });
    }
  }

  hooks?.onProgress?.(totalBytes, totalBytes);

  return {
    meta,
    events,
    firstTsMs,
    lastTsMs,
    medianTickIntervalSec: median(tickIntervalSamples),
  };
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
    if (key === "timeoutSec") return result.params.timeoutSec;
    if (key === "rearmMs") return result.params.rearmMs;
    return toComparable(result[key]);
  };
  return [...results].sort((a, b) => {
    const av = readValue(a);
    const bv = readValue(b);
    if (av === bv) return 0;
    return (av - bv) * direction;
  });
}

function buildCandidateParams(
  rnd: () => number,
  ranges: OptimizerRanges,
  base: {
    priceThresholdPct: number;
    oivThresholdPct: number;
    tpRoiPct: number;
    slRoiPct: number;
    entryOffsetPct: number;
    entryTimeoutSec: number;
    rearmDelayMs: number;
  },
  precision: OptimizerPrecision
): RandomizedParams {
  const rPrice = readRange(ranges.priceTh, 0.1, 5);
  const rOiv = readRange(ranges.oivTh, 0.1, 5);
  const rTp = readRange(ranges.tp, 0.5, 10);
  const rSl = readRange(ranges.sl, 0.5, 10);
  const rOffset = readRange(ranges.offset, 0, 0.2);
  const rTimeoutSec = readRange(ranges.timeoutSec, base.entryTimeoutSec, base.entryTimeoutSec);
  const rRearmMs = readRange(ranges.rearmMs, base.rearmDelayMs, base.rearmDelayMs);

  return {
    priceThresholdPct: quantizeAndClamp(pickRange(rnd, rPrice.min, rPrice.max), rPrice.min, rPrice.max, precision.priceTh),
    oivThresholdPct: quantizeAndClamp(pickRange(rnd, rOiv.min, rOiv.max), rOiv.min, rOiv.max, precision.oivTh),
    tpRoiPct: quantizeAndClamp(pickRange(rnd, rTp.min, rTp.max), rTp.min, rTp.max, precision.tp),
    slRoiPct: quantizeAndClamp(pickRange(rnd, rSl.min, rSl.max), rSl.min, rSl.max, precision.sl),
    entryOffsetPct: quantizeAndClamp(pickRange(rnd, rOffset.min, rOffset.max), rOffset.min, rOffset.max, precision.offset),
    timeoutSec: quantizeAndClamp(pickRange(rnd, rTimeoutSec.min, rTimeoutSec.max), rTimeoutSec.min, rTimeoutSec.max, precision.timeoutSec),
    rearmMs: quantizeAndClamp(pickRange(rnd, rRearmMs.min, rRearmMs.max), rRearmMs.min, rRearmMs.max, precision.rearmMs),
  };
}

export type RunOptimizationArgs = {
  tapeIds: string[];
  tapeFiles?: Array<{ tapeId: string; bytes: number }>;
  candidates: number;
  seed: number;
  ranges?: OptimizerRanges;
  precision?: Partial<OptimizerPrecision>;
  directionMode?: "both" | "long" | "short";
  optTfMin?: number;
  onProgress?: (done: number, total: number, partialResults: OptimizerResult[]) => void;
  shouldStop?: () => boolean;
  shouldPause?: () => boolean;
  waitWhilePaused?: () => Promise<"resumed" | "cancelled">;
  excludeNegative?: boolean;
  rememberNegatives?: boolean;
  timeRangeFromTs?: number;
  timeRangeToTs?: number;
  sim?: OptimizerSimulationParams;
  cacheDataset?: {
    symbols: string[];
    startMs: number;
    endMs: number;
  };
  cacheDatasets?: Array<{ symbols: string[]; startMs: number; endMs: number }>;
};

export type RunOptimizationHooks = {
  shouldPause?: () => boolean;
  shouldCancel?: () => boolean;
  waitWhilePaused?: () => Promise<"resumed" | "cancelled">;
  onLoadProgress?: (bytesRead: number, totalBytes: number) => void;
  onProgress?: (done: number, total: number, partialResults: OptimizerResult[]) => void;
  onBlacklistUpdate?: (summary: { count: number; skipped: number }) => void;
  onCheckpoint?: (summary: { done: number; total: number; donePercent: number; partialResults: OptimizerResult[] }) => void;
};

export async function runOptimizationCore(args: RunOptimizationArgs, hooks?: RunOptimizationHooks): Promise<{
  tapeIds: string[];
  metaByTapeId: Record<string, TapeMeta | null>;
  results: OptimizerResult[];
  cancelled: boolean;
  diagnostics?: {
    decisionsNoRefs: number;
    decisionsOk: number;
    effectiveTfMinByTapeId: Record<string, number>;
    durationMinByTapeId: Record<string, number>;
    medianTickIntervalSec: number;
  };
  blacklist?: {
    count: number;
    skipped: number;
  };
  seedInfo: {
    baseSeed: number;
    effectiveSeed: number;
    runIndex: number;
  };
}> {
  const tapeFiles = Array.isArray(args.tapeFiles) && args.tapeFiles.length
    ? args.tapeFiles
      .map((file) => ({ tapeId: safeId(String(file.tapeId)), bytes: Math.max(0, Math.floor(Number(file.bytes) || 0)) }))
      .filter((file) => file.bytes > 0)
    : args.tapeIds.map((id) => ({ tapeId: safeId(id), bytes: -1 }));
  const tapeIds = tapeFiles.map((file) => file.tapeId);
  const precision = withDefaultPrecision(args.precision);
  const baseSeed = Number.isFinite(args.seed) ? args.seed : 1;
  const baseConfig = configStore.get();
  const ranges = args.ranges ?? {};

  const tapes: Array<{ tapeId: string; meta: TapeMeta | null; events: TapeEvent[]; firstTsMs: number | null; lastTsMs: number | null }> = [];
  const globalTickIntervals: number[] = [];
  if (args.cacheDataset || (Array.isArray(args.cacheDatasets) && args.cacheDatasets.length)) {
    const datasets = (Array.isArray(args.cacheDatasets) && args.cacheDatasets.length)
      ? args.cacheDatasets
      : [args.cacheDataset!];

    // Build per-symbol time windows (can be multiple ranges combined)
    const symbolWindows = new Map<string, Array<{ startMs: number; endMs: number }>>();
    for (const ds of datasets) {
      const symbols = Array.isArray(ds?.symbols) ? ds.symbols : [];
      const startMs = Number(ds?.startMs);
      const endMs = Number(ds?.endMs);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      for (const s of symbols) {
        const sym = String(s ?? "").trim();
        if (!sym) continue;
        const list = symbolWindows.get(sym) ?? [];
        list.push({ startMs, endMs });
        symbolWindows.set(sym, list);
      }
    }

    // Normalize windows per symbol (sort + merge overlaps)
    for (const [sym, list] of symbolWindows) {
      const sorted = [...list].filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs >= w.startMs)
        .sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));
      const merged: Array<{ startMs: number; endMs: number }> = [];
      for (const w of sorted) {
        const last = merged[merged.length - 1];
        if (!last) merged.push({ startMs: w.startMs, endMs: w.endMs });
        else if (w.startMs <= last.endMs) last.endMs = Math.max(last.endMs, w.endMs);
        else merged.push({ startMs: w.startMs, endMs: w.endMs });
      }
      symbolWindows.set(sym, merged);
    }

    for (const [symbol, windows] of symbolWindows) {
      const fp = path.join(CACHE_DIR, `${symbol}.jsonl`);
      const raw = await fs.promises.readFile(fp, "utf8");
      const events: TapeEvent[] = [];
      let firstTsMs: number | null = null;
      let lastTsMs: number | null = null;

      const inAnyWindow = (candleStartMs: number): boolean => {
        // windows are sorted/merged
        for (const w of windows) {
          if (candleStartMs < w.startMs) return false;
          if (candleStartMs >= w.startMs && candleStartMs <= w.endMs) return true;
        }
        return false;
      };

      for (const line of raw.split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        const row = JSON.parse(text) as {
          startMs?: number;
          close?: string;
          open?: string;
          high?: string;
          low?: string;
          turnover?: string;
          volume?: string;
        };
        const candleStart = Number(row.startMs);
        if (!Number.isFinite(candleStart) || !inAnyWindow(candleStart)) continue;

        const open = Number(row.open);
        const close = Number(row.close);
        if (!Number.isFinite(close) || close <= 0) continue;
        const turnoverNum = Number(row.turnover);
        const volumeNum = Number(row.volume);
        const openInterestValue = Number.isFinite(turnoverNum)
          ? turnoverNum
          : Number.isFinite(volumeNum)
            ? volumeNum
            : 0;
        const candleDelta = (Number.isFinite(open) ? open : close) - close;
        const fundingRate = candleDelta === 0 ? 0 : (candleDelta < 0 ? 1e-6 : -1e-6);
        const ts = candleStart + 60_000;
        events.push({
          type: "ticker",
          ts,
          symbol,
          payload: { markPrice: close, openInterest: openInterestValue, openInterestValue, fundingRate },
        });
        events.push({ type: "kline_confirm", ts, symbol, payload: { close } });
        if (firstTsMs == null || ts < firstTsMs) firstTsMs = ts;
        if (lastTsMs == null || ts > lastTsMs) lastTsMs = ts;
      }

      tapes.push({ tapeId: symbol, meta: { symbols: [symbol], klineTfMin: 1 }, events, firstTsMs, lastTsMs });
    }
    hooks?.onLoadProgress?.(100, 100);
  }
  if (!args.cacheDataset) {
  const tapePathEntries = tapeFiles.map((file) => ({ tapeId: file.tapeId, tapePath: getTapePath(file.tapeId), byteLimit: file.bytes > -1 ? file.bytes : undefined }));
  const tapeSizes = await Promise.all(tapePathEntries.map(async ({ tapePath, byteLimit }) => {
    const statSize = (await fs.promises.stat(tapePath)).size;
    return byteLimit == null ? statSize : Math.max(0, Math.min(statSize, byteLimit));
  }));
  const totalTapeBytes = tapeSizes.reduce((sum, value) => sum + value, 0);
  const loadedTapeBytesById = new Map<string, number>();

  hooks?.onLoadProgress?.(0, totalTapeBytes);

  for (const { tapeId, tapePath, byteLimit } of tapePathEntries) {
    const readOptions = {
      ...(byteLimit != null ? { byteLimit } : {}),
      ...(args.timeRangeFromTs != null ? { timeRangeFromTs: args.timeRangeFromTs } : {}),
      ...(args.timeRangeToTs != null ? { timeRangeToTs: args.timeRangeToTs } : {}),
    };
    const parsed = await readTapeLines(tapePath, readOptions, {
      onProgress: (bytesRead, totalBytes) => {
        const bounded = Math.max(0, Math.min(totalBytes, bytesRead));
        loadedTapeBytesById.set(tapeId, bounded);
        const loadedSoFar = tapePathEntries.reduce((sum, entry, index) => {
          const fullSize = tapeSizes[index] ?? 0;
          const loaded = loadedTapeBytesById.get(entry.tapeId);
          return sum + (loaded == null ? 0 : Math.max(0, Math.min(fullSize, loaded)));
        }, 0);
        hooks?.onLoadProgress?.(loadedSoFar, totalTapeBytes);
      },
    });
    tapes.push({ tapeId, meta: parsed.meta, events: parsed.events, firstTsMs: parsed.firstTsMs, lastTsMs: parsed.lastTsMs });
    if (parsed.medianTickIntervalSec > 0 && globalTickIntervals.length < MAX_TICK_INTERVAL_SAMPLES) {
      globalTickIntervals.push(parsed.medianTickIntervalSec);
    }
  }
  hooks?.onLoadProgress?.(totalTapeBytes, totalTapeBytes);
  }
  const medianTickIntervalSec = median(globalTickIntervals);

  const results: OptimizerResult[] = [];

  // progress is reported in 0.01% steps (total=10000)
  const progressTotal = 10_000;
  let lastProgressDone = -1;
  const reportProgress = (candidateIndexDone: number) => {
    const frac = args.candidates > 0 ? candidateIndexDone / args.candidates : 0;
    const done = Math.max(0, Math.min(progressTotal, Math.floor(frac * progressTotal)));
    if (done !== lastProgressDone) {
      lastProgressDone = done;
      hooks?.onProgress?.(done, progressTotal, results);
    }
  };
  const reportProgressFrac = (candidateIndexBase: number, fracWithinCandidate: number) => {
    const fracCandidate = Math.max(0, Math.min(1, fracWithinCandidate));
    const fracGlobal = args.candidates > 0 ? (candidateIndexBase + fracCandidate) / args.candidates : 0;
    const done = Math.max(0, Math.min(progressTotal, Math.floor(fracGlobal * progressTotal)));
    if (done !== lastProgressDone) {
      lastProgressDone = done;
      hooks?.onProgress?.(done, progressTotal, results);
    }
  };
  const effectiveDirection = args.directionMode ?? "both";
  const effectiveTf = args.optTfMin ?? 0;
  const runKey = `tapes=${[...tapeIds].sort().join(",")}|dir=${effectiveDirection}|tf=${effectiveTf}`;
  const shouldRememberNegatives = Boolean(args.rememberNegatives);
  const blacklistState = shouldRememberNegatives ? loadNegativeBlacklist(runKey) : null;
  const runIndex = shouldRememberNegatives ? blacklistState?.runIndex ?? 0 : 0;
  const effectiveSeed = shouldRememberNegatives ? baseSeed + runIndex : baseSeed;
  if (blacklistState) {
    blacklistState.runIndex = runIndex + 1;
    flushNegativeBlacklist(blacklistState);
  }
  const rng = buildRng(effectiveSeed);
  let skippedBlacklisted = 0;
  let lastBlacklistFlushMs = Date.now();
  let addedSinceFlush = 0;
  let cancelled = false;
  let lastPctLocal = 0;

  const decisionsNoRefsGlobal = { value: 0 };
  const decisionsOkGlobal = { value: 0 };
  const effectiveTfMinByTapeId: Record<string, number> = {};
  const durationMinByTapeId: Record<string, number> = {};

  for (let i = 0; i < args.candidates; i += 1) {
    if (hooks?.shouldCancel?.()) {
      cancelled = true;
      break;
    }

    const params = buildCandidateParams(
      rng,
      ranges,
      {
        priceThresholdPct: baseConfig.signals.priceThresholdPct,
        oivThresholdPct: baseConfig.signals.oivThresholdPct,
        tpRoiPct: baseConfig.paper.tpRoiPct,
        slRoiPct: baseConfig.paper.slRoiPct,
        entryOffsetPct: baseConfig.paper.entryOffsetPct,
        entryTimeoutSec: baseConfig.paper.entryTimeoutSec,
        rearmDelayMs: baseConfig.paper.rearmDelayMs,
      },
      precision
    );
    const paramSig = buildParamSig(params, precision);
    if (blacklistState && blacklistState.negativeSet.has(paramSig)) {
      skippedBlacklisted += 1;
      const done = i + 1;
      reportProgress(done);
      continue;
    }

    let netPnlTotal = 0;
    let tradesTotal = 0;
    let winsTotal = 0;

    let signalsOk = 0;
    let decisionsNoRefs = 0;
    let ordersPlaced = 0;
    let ordersFilled = 0;
    let ordersExpired = 0;
    let closesTp = 0;
    let closesSl = 0;
    let closesForce = 0;

    const closes: CloseSnapshot[] = [];

    for (const tape of tapes) {
      const cache = new BybitMarketCache();
      const candles = new CandleTracker(cache);
      const fundingGate = new FundingCooldownGate(baseConfig.fundingCooldown.beforeMin, baseConfig.fundingCooldown.afterMin);
      const signalEngine = new SignalEngine({
        priceThresholdPct: params.priceThresholdPct,
        oivThresholdPct: params.oivThresholdPct,
        requireFundingSign: true,
        directionMode: args.directionMode ?? "both",
      });

      const baseTimeout = Math.max(1, Math.floor(params.timeoutSec));
      const intervalBased = Math.ceil(2 * medianTickIntervalSec);
      const effectiveEntryTimeoutSec = Math.max(baseTimeout, intervalBased, 5);

      const candidateConfig = {
        ...baseConfig,
        paper: {
          ...baseConfig.paper,
          directionMode: args.directionMode ?? baseConfig.paper.directionMode,
          marginUSDT: Number.isFinite(Number(args.sim?.marginPerTrade)) && Number(args.sim?.marginPerTrade) > 0
            ? Number(args.sim?.marginPerTrade)
            : baseConfig.paper.marginUSDT,
          leverage: Number.isFinite(Number(args.sim?.leverage)) && Number(args.sim?.leverage) >= 1
            ? Number(args.sim?.leverage)
            : baseConfig.paper.leverage,
          makerFeeRate: Number.isFinite(Number(args.sim?.feeBps))
            ? Math.max(0, Number(args.sim?.feeBps)) / 10_000
            : baseConfig.paper.makerFeeRate,
          tpRoiPct: params.tpRoiPct,
          slRoiPct: params.slRoiPct,
          entryOffsetPct: params.entryOffsetPct,
          entryTimeoutSec: effectiveEntryTimeoutSec,
          rearmDelayMs: Math.max(0, Math.floor(params.rearmMs)),
        },
      };

      const logger = {
        log(ev: any) {
          if (ev?.type === "ORDER_PLACED") ordersPlaced += 1;
          if (ev?.type === "ORDER_FILLED") ordersFilled += 1;
          if (ev?.type === "ORDER_EXPIRED") ordersExpired += 1;
          if (ev?.type === "POSITION_CLOSE_TP") {
            closesTp += 1;
            closes.push({ ts: Number(ev.ts) || 0, realizedPnl: Number(ev?.payload?.realizedPnl) || 0 });
          }
          if (ev?.type === "POSITION_CLOSE_SL") {
            closesSl += 1;
            closes.push({ ts: Number(ev.ts) || 0, realizedPnl: Number(ev?.payload?.realizedPnl) || 0 });
          }
          if (ev?.type === "POSITION_FORCE_CLOSE") {
            closesForce += 1;
            closes.push({ ts: Number(ev.ts) || 0, realizedPnl: Number(ev?.payload?.realizedPnl) || 0 });
          }
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
          if (hooks?.shouldCancel?.()) {
            cancelled = true;
            break;
          }
          if (hooks?.shouldPause?.()) {
            const pauseOutcome = await hooks?.waitWhilePaused?.();
            if (pauseOutcome === "cancelled") {
              cancelled = true;
              break;
            }
          }
          const totalEvents = tape.events.length || 1;
          const fracWithin = Math.min(1, eventCounter / totalEvents);
          reportProgressFrac(i, fracWithin);
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
          if (decision.reason === "ok_long" || decision.reason === "ok_short") signalsOk += 1;

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

    decisionsNoRefsGlobal.value += decisionsNoRefs;
    decisionsOkGlobal.value += signalsOk;

    closes.sort((a, b) => a.ts - b.ts);
    let grossProfit = 0;
    let grossLoss = 0;
    let equity = 0;
    let peak = 0;
    let maxDrawdownUsdt = 0;
    for (const close of closes) {
      const pnl = close.realizedPnl;
      if (pnl > 0) grossProfit += pnl;
      if (pnl < 0) grossLoss += pnl;
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdownUsdt) maxDrawdownUsdt = dd;
    }

    const winRatePct = tradesTotal > 0 ? (winsTotal / tradesTotal) * 100 : 0;
    const expectancy = tradesTotal > 0 ? netPnlTotal / tradesTotal : 0;
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 1_000_000_000 : 0) : grossProfit / Math.abs(grossLoss);

    const candidateResult: OptimizerResult = {
      netPnl: netPnlTotal,
      trades: tradesTotal,
      winRatePct,
      expectancy,
      profitFactor,
      maxDrawdownUsdt,
      signalsOk,
      decisionsNoRefs,
      ordersPlaced,
      ordersFilled,
      ordersExpired,
      closesTp,
      closesSl,
      closesForce,
      params,
    };
    if (blacklistState && candidateResult.netPnl < 0 && !blacklistState.negativeSet.has(paramSig)) {
      blacklistState.negativeSet.add(paramSig);
      addedSinceFlush += 1;
      const now = Date.now();
      if (addedSinceFlush >= 100 || now - lastBlacklistFlushMs >= 10_000) {
        flushNegativeBlacklist(blacklistState);
        addedSinceFlush = 0;
        lastBlacklistFlushMs = now;
      }
    }
    if (!args.excludeNegative || candidateResult.netPnl >= 0) {
      results.push(candidateResult);
    }
    // report progress in 0.01% steps (total=10000)
    const candidateDone = i + 1;
    reportProgress(candidateDone);
    const done = lastProgressDone < 0 ? 0 : lastProgressDone;
    const donePercent = progressTotal > 0 ? Math.max(0, Math.min(100, Math.round((done / progressTotal) * 10_000) / 100)) : 0;
    hooks?.onCheckpoint?.({ done, total: progressTotal, donePercent, partialResults: results });
    hooks?.onBlacklistUpdate?.({ count: blacklistState?.negativeSet.size ?? 0, skipped: skippedBlacklisted });
    // yield occasionally so worker thread can flush messages during fast runs
    if (donePercent > lastPctLocal) {
      lastPctLocal = donePercent;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  if (blacklistState && addedSinceFlush > 0) {
    flushNegativeBlacklist(blacklistState);
  }

  return {
    tapeIds,
    metaByTapeId: Object.fromEntries(tapes.map((t) => [t.tapeId, t.meta])),
    results: sortOptimizationResults(results, "netPnl", "desc"),
    cancelled,
    ...(decisionsOkGlobal.value === 0 && decisionsNoRefsGlobal.value >= 100
      ? {
          diagnostics: {
            decisionsNoRefs: decisionsNoRefsGlobal.value,
            decisionsOk: decisionsOkGlobal.value,
            effectiveTfMinByTapeId,
            durationMinByTapeId,
            medianTickIntervalSec,
          },
        }
      : {}),
    ...(blacklistState
      ? {
          blacklist: {
            count: blacklistState.negativeSet.size,
            skipped: skippedBlacklisted,
          },
        }
      : {}),
    seedInfo: {
      baseSeed,
      effectiveSeed,
      runIndex,
    },
  };
}


export async function runOptimization(args: RunOptimizationArgs) {
  const hooks: RunOptimizationHooks = {};
  if (args.onProgress) hooks.onProgress = args.onProgress;
  if (args.shouldStop) hooks.shouldCancel = args.shouldStop;
  if (args.shouldPause) hooks.shouldPause = args.shouldPause;
  if (args.waitWhilePaused) hooks.waitWhilePaused = args.waitWhilePaused;
  return runOptimizationCore(args, hooks);
}

type NegativeBlacklistFile = {
  runKey: string;
  createdAtMs: number;
  updatedAtMs: number;
  runIndex?: number;
  negativeSet: Record<string, true>;
};

type NegativeBlacklistState = {
  runKey: string;
  hash: string;
  createdAtMs: number;
  updatedAtMs: number;
  runIndex: number;
  negativeSet: Set<string>;
};

function getBlacklistDir() {
  return path.resolve(process.cwd(), "data/optimizer_blacklists");
}

function runKeyHash(runKey: string) {
  return createHash("sha1").update(runKey).digest("hex").slice(0, 12);
}

function blacklistPath(hash: string) {
  return path.join(getBlacklistDir(), `${hash}.json`);
}

function loadNegativeBlacklist(runKey: string): NegativeBlacklistState {
  const hash = runKeyHash(runKey);
  fs.mkdirSync(getBlacklistDir(), { recursive: true });
  const filePath = blacklistPath(hash);
  const now = Date.now();
  if (!fs.existsSync(filePath)) {
    return { runKey, hash, createdAtMs: now, updatedAtMs: now, runIndex: 0, negativeSet: new Set() };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as NegativeBlacklistFile;
    if (!parsed || parsed.runKey !== runKey || typeof parsed.negativeSet !== "object" || parsed.negativeSet == null) {
      return { runKey, hash, createdAtMs: now, updatedAtMs: now, runIndex: 0, negativeSet: new Set() };
    }
    return {
      runKey,
      hash,
      createdAtMs: Number(parsed.createdAtMs) || now,
      updatedAtMs: Number(parsed.updatedAtMs) || now,
      runIndex: Math.max(0, Math.floor(Number(parsed.runIndex) || 0)),
      negativeSet: new Set(Object.keys(parsed.negativeSet)),
    };
  } catch {
    return { runKey, hash, createdAtMs: now, updatedAtMs: now, runIndex: 0, negativeSet: new Set() };
  }
}

function flushNegativeBlacklist(state: NegativeBlacklistState) {
  state.updatedAtMs = Date.now();
  const negativeSet: Record<string, true> = {};
  for (const sig of state.negativeSet) negativeSet[sig] = true;
  const payload: NegativeBlacklistFile = {
    runKey: state.runKey,
    createdAtMs: state.createdAtMs,
    updatedAtMs: state.updatedAtMs,
    runIndex: state.runIndex,
    negativeSet,
  };
  fs.writeFileSync(blacklistPath(state.hash), JSON.stringify(payload, null, 2), "utf8");
}

function buildParamSig(params: RandomizedParams, precision: OptimizerPrecision): string {
  return [
    `priceTh=${params.priceThresholdPct.toFixed(precision.priceTh)}`,
    `oivTh=${params.oivThresholdPct.toFixed(precision.oivTh)}`,
    `tp=${params.tpRoiPct.toFixed(precision.tp)}`,
    `sl=${params.slRoiPct.toFixed(precision.sl)}`,
    `offset=${params.entryOffsetPct.toFixed(precision.offset)}`,
    `timeoutSec=${Math.round(params.timeoutSec)}`,
    `rearmMs=${Math.round(params.rearmMs)}`,
  ].join("|");
}
