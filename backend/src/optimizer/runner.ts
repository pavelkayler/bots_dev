import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import readline from "node:readline";
import { BybitMarketCache } from "../engine/BybitMarketCache.js";
import { CandleTracker } from "../engine/CandleTracker.js";
import { SignalEngine } from "../engine/SignalEngine.js";
import { PaperBroker, type PaperExecutionModel, type PaperStats, type PaperTickOhlc } from "../paper/PaperBroker.js";
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

export type OptimizerParams = RandomizedParams;

export type OptimizerResult = {
  rowId: string;
  candidateKey?: string;
  netPnl: number;
  trades: number;
  trainNetPnl: number;
  trainTrades: number;
  trainWinRatePct: number;
  valNetPnl: number;
  valTrades: number;
  valWinRatePct: number;
  valPnlPerTrade: number;
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
  longsCount: number;
  longsPnl: number;
  longsWinRatePct: number;
  shortsCount: number;
  shortsPnl: number;
  shortsWinRatePct: number;
  directionMode: "both" | "long" | "short";
  params: RandomizedParams;
};

export type OptimizerParamKey = "priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs";
export type OptimizerMetricSortKey =
  | "netPnl"
  | "trades"
  | "trainNetPnl"
  | "trainTrades"
  | "valNetPnl"
  | "valTrades"
  | "valPnlPerTrade"
  | "winRatePct"
  | "expectancy"
  | "profitFactor"
  | "maxDrawdownUsdt"
  | "ordersPlaced"
  | "ordersFilled"
  | "ordersExpired"
  | "longsCount"
  | "longsPnl"
  | "longsWinRatePct"
  | "shortsCount"
  | "shortsPnl"
  | "shortsWinRatePct";
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
  slippageBps?: number;
};

type CloseSnapshot = { ts: number; realizedPnl: number };

const MAX_TICK_INTERVAL_SAMPLES = 20_000;
function getCacheDir() {
  return path.resolve(process.cwd(), "data", "cache", "bybit_klines");
}

function getFundingCacheDir() {
  return path.resolve(process.cwd(), "data", "cache", "bybit_funding_history");
}
const MIN_OPT_TF_MIN = 15;
const MIN_TIMEOUT_SEC = 61;
const MINUTE_MS = 60_000;
const DEBUG_DATASET_TF = process.env.DEBUG_DATASET_TF === "1";
const DEBUG_OPT_TRADES = process.env.DEBUG_OPT_TRADES === "1";
const DEBUG_OPT_MARKETDATA = process.env.DEBUG_OPT_MARKETDATA === "1";

const INTERVAL_TO_MINUTES: Record<string, number> = {
  "1": 1,
  "3": 3,
  "5": 5,
  "15": 15,
  "30": 30,
  "60": 60,
  "120": 120,
  "240": 240,
  "360": 360,
  "720": 720,
  D: 1440,
  W: 10080,
  M: 43200,
};

function intervalToMinutes(interval: string): number {
  const n = INTERVAL_TO_MINUTES[String(interval ?? "")];
  const minutes = typeof n === "number" ? n : Number.NaN;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
}

function cachePathForSymbolInterval(symbol: string, interval: string): string {
  return path.join(getCacheDir(), interval, `${symbol}.jsonl`);
}

function resolveReadCachePath(symbol: string, interval: string): string {
  const scoped = cachePathForSymbolInterval(symbol, interval);
  if (fs.existsSync(scoped)) return scoped;
  if (interval === "1") {
    const legacy = path.join(getCacheDir(), `${symbol}.jsonl`);
    if (fs.existsSync(legacy)) return legacy;
  }
  return scoped;
}

function loadFundingHistory(symbol: string): Array<{ ts: number; rate: number }> {
  const fp = path.join(getFundingCacheDir(), `${symbol}.jsonl`);
  if (!fs.existsSync(fp)) return [];
  const out: Array<{ ts: number; rate: number }> = [];
  const raw = fs.readFileSync(fp, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      const row = JSON.parse(text) as { timestamp?: number; fundingRate?: string };
      const ts = Number(row?.timestamp);
      const rate = Number(row?.fundingRate);
      if (Number.isFinite(ts) && Number.isFinite(rate)) out.push({ ts, rate });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

export function fundingRateAtTs(samples: Array<{ ts: number; rate: number }>, ts: number): number {
  if (!samples.length) return 0;
  let lo = 0;
  let hi = samples.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = samples[mid]!;
    if (row.ts <= ts) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? samples[ans]!.rate : 0;
}

export type ReplayCacheRow = {
  startMs?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  oi?: string;
};

export function createReplayEventsFromCacheRows(args: {
  rows: ReplayCacheRow[];
  windows: Array<{ startMs: number; endMs: number }>;
  replayIntervalMin: number;
  symbol: string;
  fundingSamples: Array<{ ts: number; rate: number }>;
}) {
  const { rows, windows, replayIntervalMin, symbol, fundingSamples } = args;
  const events: TapeEvent[] = [];
  let firstTsMs: number | null = null;
  let lastTsMs: number | null = null;
  let candleCount = 0;
  let candleWithOiCount = 0;
  let candleWithFundingCount = 0;

  const inAnyWindow = (candleStartMs: number): boolean => {
    for (const w of windows) {
      if (candleStartMs < w.startMs) return false;
      if (candleStartMs >= w.startMs && candleStartMs <= w.endMs) return true;
    }
    return false;
  };

  for (const row of rows) {
    const candleStart = Number(row.startMs);
    if (!Number.isFinite(candleStart) || !inAnyWindow(candleStart)) continue;

    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (!Number.isFinite(close) || close <= 0) continue;
    const hasOhlc = Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low);
    const ohlc: PaperTickOhlc | undefined = hasOhlc ? { open, high, low, close } : undefined;
    const oiBase = Number(row.oi);
    if (Number.isFinite(oiBase) && oiBase > 0) candleWithOiCount += 1;
    const openInterestValue = Number.isFinite(oiBase) && oiBase > 0 ? oiBase * close : 0;
    const tsClose = candleStart + replayIntervalMin * 60_000;
    const fundingRate = fundingRateAtTs(fundingSamples, tsClose);
    if (fundingRate !== 0) candleWithFundingCount += 1;

    events.push({
      type: "ticker",
      ts: tsClose,
      symbol,
      payload: {
        markPrice: close,
        ...(ohlc ? { ohlc } : {}),
        openInterest: openInterestValue,
        openInterestValue,
        fundingRate,
      },
    });
    events.push({ type: "kline_confirm", ts: tsClose, symbol, payload: { close } });

    if (firstTsMs == null || candleStart < firstTsMs) firstTsMs = candleStart;
    if (lastTsMs == null || tsClose > lastTsMs) lastTsMs = tsClose;
    candleCount += 1;
  }

  return { events, firstTsMs, lastTsMs, candleCount, candleWithOiCount, candleWithFundingCount };
}

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

function floorToMinute(tsMs: number): number {
  if (!Number.isFinite(tsMs)) return 0;
  return Math.floor(tsMs / MINUTE_MS) * MINUTE_MS;
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
  jobId?: string;
  runId?: string;
  tapeIds: string[];
  tapeFiles?: Array<{ tapeId: string; bytes: number }>;
  candidates: number;
  seed: number;
  ranges?: OptimizerRanges;
  precision?: Partial<OptimizerPrecision>;
  directionMode?: "both" | "long" | "short";
  optTfMin?: number;
  executionModel?: PaperExecutionModel;
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
    interval?: string;
  };
  cacheDatasets?: Array<{ symbols: string[]; startMs: number; endMs: number; interval?: string }>;
  fixedParams?: OptimizerParams;
};

export type RunOptimizationHooks = {
  shouldPause?: () => boolean;
  shouldCancel?: () => boolean;
  waitWhilePaused?: () => Promise<"resumed" | "cancelled">;
  onLoadProgress?: (bytesRead: number, totalBytes: number) => void;
  onProgress?: (done: number, total: number, partialResults: OptimizerResult[]) => void;
  onBlacklistUpdate?: (summary: { count: number; skipped: number }) => void;
  onCheckpoint?: (summary: {
    done: number;
    total: number;
    donePercent: number;
    partialResults: OptimizerResult[];
    skippedBlacklistedTotal: number;
    negativeSetSize: number;
  }) => void;
  onRowsAppend?: (rows: OptimizerResult[]) => void;
  onCandidateComplete?: (summary: { params: OptimizerParams; trades: any[]; stats: PaperStats }) => void;
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
  let sampleSymbolForDebug = "";
  let sampleSymbolCandleCount = 0;
  let sampleSymbolOiSamplesUsed = 0;
  let sampleSymbolFundingSamplesUsed = 0;
  let sampleIntervalForDebug = "1";
  let debugPlacedOrders = 0;
  let debugFilledOrders = 0;
  let debugClosedTrades = 0;
  if (args.cacheDataset || (Array.isArray(args.cacheDatasets) && args.cacheDatasets.length)) {
    const datasets = (Array.isArray(args.cacheDatasets) && args.cacheDatasets.length)
      ? args.cacheDatasets
      : [args.cacheDataset!];

    const datasetInterval = String((datasets[0] as any)?.interval ?? args.optTfMin ?? "1");
    const baseInterval = "1";

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
      if (!sampleSymbolForDebug) sampleSymbolForDebug = symbol;
      const baseFp = resolveReadCachePath(symbol, baseInterval);
      const datasetFp = resolveReadCachePath(symbol, datasetInterval);
      const fp = fs.existsSync(baseFp) ? baseFp : datasetFp;
      const replayInterval = fs.existsSync(baseFp) ? baseInterval : datasetInterval;
      const replayIntervalMin = intervalToMinutes(replayInterval);
      if (symbol === sampleSymbolForDebug) sampleIntervalForDebug = replayInterval;
      const raw = await fs.promises.readFile(fp, "utf8");
      const rows: ReplayCacheRow[] = [];
      const fundingSamples = loadFundingHistory(symbol);

      for (const line of raw.split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        rows.push(JSON.parse(text) as ReplayCacheRow);
      }

      const {
        events,
        firstTsMs,
        lastTsMs,
        candleCount,
        candleWithOiCount,
        candleWithFundingCount,
      } = createReplayEventsFromCacheRows({ rows, windows, replayIntervalMin, symbol, fundingSamples });

      if (symbol === sampleSymbolForDebug) {
        sampleSymbolCandleCount = candleCount;
        sampleSymbolOiSamplesUsed = candleWithOiCount;
        sampleSymbolFundingSamplesUsed = candleWithFundingCount;
      }

      let prevTickerTs: number | null = null;
      const tickerDeltasSec: number[] = [];
      for (const event of events) {
        if (event.type !== "ticker") continue;
        if (prevTickerTs != null && event.ts > prevTickerTs) {
          tickerDeltasSec.push((event.ts - prevTickerTs) / 1000);
        }
        prevTickerTs = event.ts;
      }
      const tapeMedianTickIntervalSec = median(tickerDeltasSec);
      if (tapeMedianTickIntervalSec > 0 && globalTickIntervals.length < MAX_TICK_INTERVAL_SAMPLES) {
        globalTickIntervals.push(tapeMedianTickIntervalSec);
      }

      if (DEBUG_DATASET_TF && tapes.length === 0) {
        const firstTs = events.length ? events[0]?.ts ?? null : null;
        const lastTs = events.length ? events[events.length - 1]?.ts ?? null : null;
        console.log("[optimizer-dataset-tf]", { symbol, interval: replayInterval, tfMin: replayIntervalMin, firstTs, lastTs, candleCount });
      }
      tapes.push({ tapeId: symbol, meta: { symbols: [symbol], klineTfMin: replayIntervalMin }, events, firstTsMs, lastTsMs });
    }
    hooks?.onLoadProgress?.(100, 100);
    if (DEBUG_OPT_MARKETDATA) {
      const oiPct = sampleSymbolCandleCount > 0 ? (sampleSymbolOiSamplesUsed / Math.max(1, sampleSymbolCandleCount)) * 100 : 0;
      const fundingPct = sampleSymbolCandleCount > 0 ? (sampleSymbolFundingSamplesUsed / Math.max(1, sampleSymbolCandleCount)) * 100 : 0;
      console.log("[optimizer-marketdata]", {
        interval: sampleIntervalForDebug,
        sampleSymbol: sampleSymbolForDebug || null,
        candlesRead: sampleSymbolCandleCount,
        oiSamplesUsed: sampleSymbolOiSamplesUsed,
        fundingSamplesUsed: sampleSymbolFundingSamplesUsed,
        candlesWithOiPct: Number(oiPct.toFixed(2)),
        candlesWithFundingPct: Number(fundingPct.toFixed(2)),
      });
    }
  }
  if (!(args.cacheDataset || (Array.isArray(args.cacheDatasets) && args.cacheDatasets.length))) {
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
  const resolvedJobId = String(args.jobId ?? "").trim() || "job";
  const resolvedRunId = String(args.runId ?? "").trim() || resolvedJobId;

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
  const effectiveTf = Math.max(Math.floor(Number(args.optTfMin ?? MIN_OPT_TF_MIN)) || MIN_OPT_TF_MIN, MIN_OPT_TF_MIN);
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

  let evaluated = 0;
  let attempts = 0;
  const attemptsCap = Math.max(args.candidates * 50, args.candidates);
  while (evaluated < args.candidates && attempts < attemptsCap) {
    attempts += 1;
    if (hooks?.shouldCancel?.()) {
      cancelled = true;
      break;
    }

    const randomizedParams = args.fixedParams ?? buildCandidateParams(
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
    const params = {
      ...randomizedParams,
      timeoutSec: Math.max(Number(randomizedParams.timeoutSec) || 0, MIN_TIMEOUT_SEC),
      rearmMs: Math.max(Number(randomizedParams.rearmMs) || 0, effectiveTf * 60_000),
    };
    const candidateKey = buildCandidateKey(params, effectiveDirection, effectiveTf, args.sim);
    const effectiveExecutionModel: PaperExecutionModel = args.executionModel ?? "closeOnly";
    if (blacklistState && blacklistState.negativeSet.has(candidateKey)) {
      skippedBlacklisted += 1;
      hooks?.onBlacklistUpdate?.({ count: blacklistState?.negativeSet.size ?? 0, skipped: skippedBlacklisted });
      continue;
    }

    const candidateIndexBase = evaluated;

    let netPnlTotal = 0;
    let tradesTotal = 0;
    let winsTotal = 0;
    let trainNetPnlTotal = 0;
    let trainTradesTotal = 0;
    let trainWinsTotal = 0;
    let valNetPnlTotal = 0;
    let valTradesTotal = 0;
    let valWinsTotal = 0;
    let feesPaidTotal = 0;
    let fundingAccruedTotal = 0;

    let signalsOk = 0;
    let decisionsNoRefs = 0;
    let ordersPlaced = 0;
    let ordersFilled = 0;
    let ordersExpired = 0;
    let closesTp = 0;
    let closesSl = 0;
    let closesForce = 0;
    let longsCount = 0;
    let longsPnl = 0;
    let longsWins = 0;
    let shortsCount = 0;
    let shortsPnl = 0;
    let shortsWins = 0;
    const tradeEvents: any[] = [];

    const closes: CloseSnapshot[] = [];

    for (const tape of tapes) {
      const durationMs = Math.max(0, (tape.lastTsMs ?? 0) - (tape.firstTsMs ?? 0));
      const durationMin = durationMs / 60_000;
      const effectiveTfMin = Math.max(Math.floor(Number(args.optTfMin ?? MIN_OPT_TF_MIN)) || MIN_OPT_TF_MIN, MIN_OPT_TF_MIN);
      const tfMs = effectiveTfMin * 60_000;
      effectiveTfMinByTapeId[tape.tapeId] = effectiveTfMin;
      durationMinByTapeId[tape.tapeId] = durationMin;

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
          entryTimeoutSec: Math.max(params.timeoutSec, MIN_TIMEOUT_SEC),
          rearmDelayMs: Math.max(params.rearmMs, effectiveTfMin * 60_000),
          applyFunding: false,
          executionModel: effectiveExecutionModel,
        },
      };

      const logger = {
        log(ev: any) {
          if (ev?.type === "ORDER_PLACED") ordersPlaced += 1;
          if (ev?.type === "ORDER_FILLED") ordersFilled += 1;
          if (ev?.type === "ORDER_EXPIRED") ordersExpired += 1;
          if (ev?.type === "POSITION_CLOSE_TP") {
            closesTp += 1;
            const realizedPnl = Number(ev?.payload?.realizedPnl) || 0;
            const side = String(ev?.payload?.side ?? "").toUpperCase();
            if (side === "LONG") {
              longsCount += 1;
              longsPnl += realizedPnl;
              if (realizedPnl > 0) longsWins += 1;
            }
            if (side === "SHORT") {
              shortsCount += 1;
              shortsPnl += realizedPnl;
              if (realizedPnl > 0) shortsWins += 1;
            }
            closes.push({ ts: Number(ev.ts) || 0, realizedPnl });
            tradeEvents.push({ type: ev.type, ts: Number(ev.ts) || 0, payload: ev?.payload ?? {} });
          }
          if (ev?.type === "POSITION_CLOSE_SL") {
            closesSl += 1;
            const realizedPnl = Number(ev?.payload?.realizedPnl) || 0;
            const side = String(ev?.payload?.side ?? "").toUpperCase();
            if (side === "LONG") {
              longsCount += 1;
              longsPnl += realizedPnl;
              if (realizedPnl > 0) longsWins += 1;
            }
            if (side === "SHORT") {
              shortsCount += 1;
              shortsPnl += realizedPnl;
              if (realizedPnl > 0) shortsWins += 1;
            }
            closes.push({ ts: Number(ev.ts) || 0, realizedPnl });
            tradeEvents.push({ type: ev.type, ts: Number(ev.ts) || 0, payload: ev?.payload ?? {} });
          }
          if (ev?.type === "POSITION_FORCE_CLOSE") {
            closesForce += 1;
            closes.push({ ts: Number(ev.ts) || 0, realizedPnl: Number(ev?.payload?.realizedPnl) || 0 });
          }
        },
      };

      const runSegment = async (segmentStartMs: number, segmentEndMs: number, progressOffset: number) => {
        const cache = new BybitMarketCache();
        const candles = new CandleTracker(cache);
        const signalEngine = new SignalEngine({
          priceThresholdPct: params.priceThresholdPct,
          oivThresholdPct: params.oivThresholdPct,
          requireFundingSign: true,
          directionMode: args.directionMode ?? "both",
        });
        const paper = new PaperBroker(candidateConfig.paper, logger as any);
        let lastEventTs = 0;
        const cadenceBySymbol = new Map<string, {
          prevWindowClose: number | null;
          prevWindowOivClose: number | null;
        }>();

        let eventCounter = 0;
        for (const event of tape.events) {
          const tsRaw = Number(event.ts) || 0;
          const ts = tsRaw > 0 && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
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
            const fracWithin = Math.min(1, (eventCounter / totalEvents) * 0.5 + progressOffset);
            reportProgressFrac(candidateIndexBase, fracWithin);
            await new Promise<void>((resolve) => setImmediate(resolve));
          }

          if (ts < segmentStartMs || ts > segmentEndMs) continue;
          if (ts > lastEventTs) lastEventTs = ts;

          if (event.type === "ticker") {
            cache.upsertFromTicker(event.symbol, event.payload ?? {});

            const row = cache.getRawRow(event.symbol);
            const markPrice = Number(row?.markPrice ?? 0);
            const openInterestValue = Number(row?.openInterestValue ?? 0);
            const fundingRate = Number(row?.fundingRate ?? 0);
            const isWindowClose = tfMs > 0 && ts % tfMs === 0;

            if (!isWindowClose) {
              const tickOhlc = (event.payload as { ohlc?: PaperTickOhlc } | undefined)?.ohlc;
              paper.tick({
                symbol: event.symbol,
                nowMs: ts,
                markPrice,
                ...(tickOhlc ? { ohlc: tickOhlc } : {}),
                fundingRate,
                nextFundingTime: 0,
                signal: null,
                signalReason: "wait_window_close",
                cooldownActive: false,
              });
              continue;
            }

            const cadenceState = cadenceBySymbol.get(event.symbol) ?? {
              prevWindowClose: null,
              prevWindowOivClose: null,
            };

            let signal: "LONG" | "SHORT" | null = null;
            let signalReason = "window_seed";

            if (cadenceState.prevWindowClose == null || cadenceState.prevWindowOivClose == null) {
              if (Number.isFinite(markPrice) && markPrice > 0) cadenceState.prevWindowClose = markPrice;
              if (Number.isFinite(openInterestValue) && openInterestValue >= 0) cadenceState.prevWindowOivClose = openInterestValue;
            } else {
              const priceMovePct = pctChange(markPrice, cadenceState.prevWindowClose);
              const oivMovePct = openInterestValue > 0 ? pctChange(openInterestValue, cadenceState.prevWindowOivClose) : null;
              const decision = signalEngine.decide({
                priceMovePct,
                oivMovePct,
                fundingRate,
                cooldownActive: false,
              });
              signal = decision.signal;
              signalReason = decision.reason;
              if (decision.reason === "no_refs") decisionsNoRefs += 1;
              if (decision.reason === "ok_long" || decision.reason === "ok_short") signalsOk += 1;
              cadenceState.prevWindowClose = markPrice;
              cadenceState.prevWindowOivClose = openInterestValue;
            }

            cadenceBySymbol.set(event.symbol, cadenceState);

            const tickOhlc = (event.payload as { ohlc?: PaperTickOhlc } | undefined)?.ohlc;
            paper.tick({
              symbol: event.symbol,
              nowMs: ts,
              markPrice,
              ...(tickOhlc ? { ohlc: tickOhlc } : {}),
              fundingRate,
              nextFundingTime: 0,
              signal,
              signalReason,
              cooldownActive: false,
            });
          }

          if (event.type === "kline_confirm") {
            candles.ingestKline(event.symbol, { confirm: true, close: event.payload?.close });
          }
        }

        if (cancelled) return null;

        const symbols = Array.isArray(tape.meta?.symbols) ? tape.meta.symbols : [];
        paper.stopAll({
          nowMs: lastEventTs || segmentEndMs || 0,
          symbols,
          getMarkPrice: (symbol: string) => cache.getMarkPrice(symbol),
          closeOpenPositions: false,
        });
        return paper.getStats();
      };

      const tapeStartMs = floorToMinute(Number(tape.firstTsMs ?? 0));
      const tapeEndMs = floorToMinute(Number(tape.lastTsMs ?? 0));
      const totalMs = Math.max(0, tapeEndMs - tapeStartMs);
      const splitRawMs = tapeStartMs + Math.floor(totalMs * 0.7);
      const splitMs = Math.max(tapeStartMs, Math.min(tapeEndMs, floorToMinute(splitRawMs)));

      const trainStats = await runSegment(tapeStartMs, splitMs, 0);
      if (cancelled || !trainStats) break;
      const valStats = await runSegment(splitMs, tapeEndMs, 0.5);
      if (cancelled || !valStats) break;

      trainNetPnlTotal += trainStats.netRealized;
      trainTradesTotal += trainStats.closedTrades;
      trainWinsTotal += trainStats.wins;
      valNetPnlTotal += valStats.netRealized;
      valTradesTotal += valStats.closedTrades;
      valWinsTotal += valStats.wins;

      const tapeStats = {
        netRealized: trainStats.netRealized + valStats.netRealized,
        closedTrades: trainStats.closedTrades + valStats.closedTrades,
        wins: trainStats.wins + valStats.wins,
        feesPaid: (Number(trainStats.feesPaid) || 0) + (Number(valStats.feesPaid) || 0),
        fundingAccrued: (Number(trainStats.fundingAccrued) || 0) + (Number(valStats.fundingAccrued) || 0),
      };
      netPnlTotal += tapeStats.netRealized;
      tradesTotal += tapeStats.closedTrades;
      winsTotal += tapeStats.wins;
      feesPaidTotal += tapeStats.feesPaid;
      fundingAccruedTotal += tapeStats.fundingAccrued;
      debugClosedTrades += tapeStats.closedTrades;
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
    const trainWinRatePct = trainTradesTotal > 0 ? (trainWinsTotal / trainTradesTotal) * 100 : 0;
    const valWinRatePct = valTradesTotal > 0 ? (valWinsTotal / valTradesTotal) * 100 : 0;
    const valPnlPerTrade = valTradesTotal > 0 ? valNetPnlTotal / valTradesTotal : 0;
    const longsWinRatePct = longsCount > 0 ? (longsWins / longsCount) * 100 : 0;
    const shortsWinRatePct = shortsCount > 0 ? (shortsWins / shortsCount) * 100 : 0;
    const expectancy = tradesTotal > 0 ? netPnlTotal / tradesTotal : 0;
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 1_000_000_000 : 0) : grossProfit / Math.abs(grossLoss);

    debugPlacedOrders += ordersPlaced;
    debugFilledOrders += ordersFilled;

    const candidateResult: OptimizerResult = {
      rowId: `${resolvedJobId}:${resolvedRunId}:${candidateKey}`,
      candidateKey,
      netPnl: netPnlTotal,
      trades: tradesTotal,
      trainNetPnl: trainNetPnlTotal,
      trainTrades: trainTradesTotal,
      trainWinRatePct,
      valNetPnl: valNetPnlTotal,
      valTrades: valTradesTotal,
      valWinRatePct,
      valPnlPerTrade,
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
      longsCount,
      longsPnl,
      longsWinRatePct,
      shortsCount,
      shortsPnl,
      shortsWinRatePct,
      directionMode: args.directionMode ?? "both",
      params,
    };
    hooks?.onCandidateComplete?.({
      params,
      trades: tradeEvents,
      stats: {
        openPositions: 0,
        pendingOrders: 0,
        closedTrades: tradesTotal,
        wins: winsTotal,
        losses: Math.max(0, tradesTotal - winsTotal),
        netRealized: netPnlTotal,
        feesPaid: feesPaidTotal,
        fundingAccrued: fundingAccruedTotal,
      },
    });
    if (blacklistState && candidateResult.netPnl < 0 && !blacklistState.negativeSet.has(candidateKey)) {
      blacklistState.negativeSet.add(candidateKey);
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
      hooks?.onRowsAppend?.([candidateResult]);
    }
    // report progress in 0.01% steps (total=10000)
    evaluated += 1;
    const candidateDone = evaluated;
    reportProgress(candidateDone);
    const done = lastProgressDone < 0 ? 0 : lastProgressDone;
    const donePercent = progressTotal > 0 ? Math.max(0, Math.min(100, Math.round((done / progressTotal) * 10_000) / 100)) : 0;
    hooks?.onCheckpoint?.({
      done,
      total: progressTotal,
      donePercent,
      partialResults: results,
      skippedBlacklistedTotal: skippedBlacklisted,
      negativeSetSize: blacklistState?.negativeSet.size ?? 0,
    });
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

  if (DEBUG_OPT_TRADES || DEBUG_OPT_MARKETDATA) {
    console.log("[optimizer-run-summary]", {
      interval: String((args.cacheDatasets?.[0]?.interval ?? args.cacheDataset?.interval ?? args.optTfMin ?? "1")),
      sampleSymbol: sampleSymbolForDebug || null,
      candleCount: sampleSymbolCandleCount,
      placedOrders: debugPlacedOrders,
      filledOrders: debugFilledOrders,
      closedTrades: debugClosedTrades,
    });
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


export async function simulateCandidateTrades(args: RunOptimizationArgs, params: OptimizerParams): Promise<{ trades: any[]; stats: PaperStats; }> {
  let captured: { trades: any[]; stats: PaperStats } | null = null;
  await runOptimizationCore(
    {
      ...args,
      candidates: 1,
      excludeNegative: false,
      rememberNegatives: false,
      fixedParams: params,
    },
    {
      onCandidateComplete: (summary) => {
        captured = {
          trades: summary.trades
            .filter((ev) => ev?.type === "POSITION_CLOSE_TP" || ev?.type === "POSITION_CLOSE_SL")
            .map((ev) => ({
              type: ev.type,
              side: ev?.payload?.side,
              entryPrice: ev?.payload?.entryPrice,
              closePrice: ev?.payload?.closePrice,
              qty: ev?.payload?.qty,
              pnlFromMove: ev?.payload?.pnlFromMove,
              feesPaid: ev?.payload?.feesPaid,
              realizedPnl: ev?.payload?.realizedPnl,
              minRoiPct: ev?.payload?.minRoiPct,
              maxRoiPct: ev?.payload?.maxRoiPct,
              closedAt: ev?.payload?.closedAt,
              symbol: ev?.payload?.symbol,
            })),
          stats: summary.stats,
        };
      },
    }
  );
  return captured ?? {
    trades: [],
    stats: {
      openPositions: 0,
      pendingOrders: 0,
      closedTrades: 0,
      wins: 0,
      losses: 0,
      netRealized: 0,
      feesPaid: 0,
      fundingAccrued: 0,
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

export function loadNegativeBlacklist(runKey: string): NegativeBlacklistState {
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

export function flushNegativeBlacklist(state: NegativeBlacklistState) {
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


export function buildCandidateKey(
  params: RandomizedParams,
  directionMode: "both" | "long" | "short",
  optTfMin: number,
  sim: OptimizerSimulationParams | undefined
): string {
  const normalized = {
    directionMode,
    optTfMin,
    sim: {
      marginPerTrade: Number(sim?.marginPerTrade) || 0,
      leverage: Number(sim?.leverage) || 0,
      feeBps: Number(sim?.feeBps) || 0,
      slippageBps: Number(sim?.slippageBps) || 0,
    },
    params: {
      priceThresholdPct: Number(params.priceThresholdPct) || 0,
      oivThresholdPct: Number(params.oivThresholdPct) || 0,
      tpRoiPct: Number(params.tpRoiPct) || 0,
      slRoiPct: Number(params.slRoiPct) || 0,
      entryOffsetPct: Number(params.entryOffsetPct) || 0,
      timeoutSec: Number(params.timeoutSec) || 0,
      rearmMs: Number(params.rearmMs) || 0,
    },
  };
  return JSON.stringify(normalized);
}
