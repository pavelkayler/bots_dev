import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  readDatasetTarget,
  writeDatasetTarget,
  type DatasetRangePreset,
  type DatasetTarget,
  type BybitKlineInterval,
  normalizeBybitKlineInterval,
} from "../dataset/datasetTargetStore.js";
import { readUniverse } from "../universe/universeStore.js";
import { upsertLatestDatasetHistory } from "./datasetHistoryStore.js";

type ReceiveStatus = "queued" | "running" | "done" | "error" | "cancelled";

type ReceiveProgress = {
  pct: number;
  completedSteps: number;
  totalSteps: number;
  currentSymbol?: string;
  message?: string;
};

export type ReceiveJobView = {
  id: string;
  status: ReceiveStatus;
  progress: ReceiveProgress;
  startedAtMs?: number;
  finishedAtMs?: number;
  error?: { code: string; message: string };
};

type ReceiveJobInternal = ReceiveJobView & {
  cancelRequested: boolean;
  lastProgressEmitMs: number;
};

type BybitApiResponse = {
  retCode?: number;
  retMsg?: string;
  result?: {
    list?: string[][];
  };
};

type BybitOpenInterestItem = {
  openInterest?: string;
  timestamp?: string;
};

type BybitOpenInterestResponse = {
  retCode?: number;
  retMsg?: string;
  result?: {
    list?: BybitOpenInterestItem[];
    nextPageCursor?: string;
  };
};

type BybitFundingItem = {
  fundingRate?: string;
  fundingRateTimestamp?: string;
};

type BybitFundingHistoryResponse = {
  retCode?: number;
  retMsg?: string;
  result?: {
    list?: BybitFundingItem[];
  };
};

type OiIntervalTime = "5min" | "15min" | "30min" | "1h" | "4h" | "1d";

const BYBIT_BASE_URL = process.env.BYBIT_REST_URL ?? "https://api.bybit.com";
const REQUEST_LIMIT = 1000;
const WINDOW_MS = 5000;
const RATE_LIMIT_MAX_REQUESTS = 500;
const INTERVAL_MS_MAP: Partial<Record<BybitKlineInterval, number>> = {
  "1": 60_000,
  "3": 3 * 60_000,
  "5": 5 * 60_000,
  "15": 15 * 60_000,
  "30": 30 * 60_000,
  "60": 60 * 60_000,
  "120": 120 * 60_000,
  "240": 240 * 60_000,
  "360": 360 * 60_000,
  "720": 720 * 60_000,
  D: 24 * 60 * 60_000,
  W: 7 * 24 * 60 * 60_000,
  M: 30 * 24 * 60 * 60_000,
};

function intervalToMs(interval: BybitKlineInterval): number {
  const ms = INTERVAL_MS_MAP[interval];
  return Number.isFinite(ms) && ms! > 0 ? Number(ms) : 60_000;
}

function cacheDirByInterval(interval: BybitKlineInterval): string {
  return path.join(CACHE_DIR, interval);
}

function symbolCachePath(symbol: string, interval: BybitKlineInterval): string {
  return path.join(cacheDirByInterval(interval), `${symbol}.jsonl`);
}

function legacySymbolCachePath(symbol: string): string {
  return path.join(CACHE_DIR, `${symbol}.jsonl`);
}

function resolveReadCachePath(symbol: string, interval: BybitKlineInterval): string {
  const scoped = symbolCachePath(symbol, interval);
  if (fs.existsSync(scoped)) return scoped;
  if (interval === "1") {
    const legacy = legacySymbolCachePath(symbol);
    if (fs.existsSync(legacy)) return legacy;
  }
  return scoped;
}

const PROGRESS_THROTTLE_MS = 80;
const MAX_RANGE_MS = 180 * 24 * 60 * 60 * 1000;
const CACHE_DIR = path.resolve(process.cwd(), "data", "cache", "bybit_klines");



const jobs = new Map<string, ReceiveJobInternal>();

class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private windowStartMs = 0;
  private requestCount = 0;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async acquire() {
    while (true) {
      const now = Date.now();
      if (this.windowStartMs === 0 || now - this.windowStartMs >= this.windowMs) {
        this.windowStartMs = now;
        this.requestCount = 0;
      }
      if (this.requestCount < this.maxRequests) {
        this.requestCount += 1;
        return;
      }
      const waitMs = Math.max(1, this.windowMs - (now - this.windowStartMs));
      await sleep(waitMs);
    }
  }
}

const limiter = new RateLimiter(RATE_LIMIT_MAX_REQUESTS, WINDOW_MS);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function waitImmediate() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function resolveRangeMs(target: DatasetTarget["range"], nowMs: number): { startMs: number; endMs: number } | null {
  if (target.kind === "manual") {
    return { startMs: target.startMs, endMs: target.endMs };
  }

  const presetToMs: Record<DatasetRangePreset, number> = {
    "6h": 6 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "48h": 48 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
    "2w": 14 * 24 * 60 * 60 * 1000,
    "4w": 28 * 24 * 60 * 60 * 1000,
    "1mo": 30 * 24 * 60 * 60 * 1000,
  };
  const delta = presetToMs[target.preset];
  if (!delta) return null;
  return { startMs: nowMs - delta, endMs: nowMs };
}

function loadSymbolCache(symbol: string, interval: BybitKlineInterval): Map<number, any> {
  const out = new Map<number, any>();
  const fp = resolveReadCachePath(symbol, interval);
  if (!fs.existsSync(fp)) return out;
  const raw = fs.readFileSync(fp, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as any;
      const startMs = Number(row?.startMs);
      if (!Number.isFinite(startMs)) continue;
      out.set(startMs, row);
    } catch {
      continue;
    }
  }
  return out;
}

function writeSymbolCache(symbol: string, interval: BybitKlineInterval, rows: Map<number, any>) {
  fs.mkdirSync(cacheDirByInterval(interval), { recursive: true });
  const sorted = Array.from(rows.entries()).sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  const body = sorted.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(symbolCachePath(symbol, interval), body ? `${body}\n` : "", "utf8");
}

function toReceiveError(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

function setProgress(job: ReceiveJobInternal, patch: Partial<ReceiveProgress>, force = false) {
  const now = Date.now();
  if (!force && now - job.lastProgressEmitMs < PROGRESS_THROTTLE_MS) return;
  job.progress = {
    ...job.progress,
    ...patch,
  };
  const total = Math.max(1, job.progress.totalSteps);
  const clampedCompleted = Math.min(total, Math.max(0, job.progress.completedSteps));
  job.progress.completedSteps = clampedCompleted;
  job.progress.pct = Math.floor((clampedCompleted / total) * 100);
  job.lastProgressEmitMs = now;
}

async function fetchKlinesBatch(symbol: string, interval: BybitKlineInterval, startMs: number, endMs: number): Promise<string[][]> {
  const url = new URL(`${BYBIT_BASE_URL.replace(/\/+$/g, "")}/v5/market/kline`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("start", String(startMs));
  url.searchParams.set("end", String(endMs));
  url.searchParams.set("limit", String(REQUEST_LIMIT));

  for (let attempt = 0; attempt < 4; attempt++) {
    await limiter.acquire();
    const res = await fetch(url.toString(), { method: "GET" });
    const json = (await res.json()) as BybitApiResponse;
    const retCode = Number(json?.retCode ?? 0);
    if (res.ok && retCode === 0) {
      const rows = Array.isArray(json?.result?.list) ? json.result!.list! : [];
      return rows;
    }

    const isRateLimited = retCode === 10006 || res.status === 429;
    if (isRateLimited && attempt < 3) {
      await sleep(300 * (attempt + 1));
      continue;
    }

    const msg = String(json?.retMsg ?? `http_${res.status}`);
    const err = new Error(`kline_fetch_failed:${symbol}:${retCode}:${msg}`);
    (err as any).retCode = retCode;
    throw err;
  }

  return [];
}

function mapKlineIntervalToOiInterval(interval: BybitKlineInterval): OiIntervalTime {
  if (interval === "1" || interval === "3" || interval === "5") return "5min";
  if (interval === "15") return "15min";
  if (interval === "30") return "30min";
  if (interval === "60" || interval === "120") return "1h";
  if (interval === "240" || interval === "360" || interval === "720") return "4h";
  return "1d";
}

async function fetchOpenInterestPage(
  symbol: string,
  oiIntervalTime: OiIntervalTime,
  startMs: number,
  endMs: number,
  cursor?: string
): Promise<{ list: Array<{ openInterest: string; timestamp: number }>; nextPageCursor?: string }> {
  const url = new URL(`${BYBIT_BASE_URL.replace(/\/+$/g, "")}/v5/market/open-interest`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("intervalTime", oiIntervalTime);
  url.searchParams.set("startTime", String(startMs));
  url.searchParams.set("endTime", String(endMs));
  url.searchParams.set("limit", "200");
  if (cursor) url.searchParams.set("cursor", cursor);

  await limiter.acquire();
  const res = await fetch(url.toString(), { method: "GET" });
  const json = (await res.json()) as BybitOpenInterestResponse;
  const retCode = Number(json?.retCode ?? 0);
  if (!(res.ok && retCode === 0)) {
    const msg = String(json?.retMsg ?? `http_${res.status}`);
    throw new Error(`oi_fetch_failed:${symbol}:${retCode}:${msg}`);
  }
  const list = Array.isArray(json?.result?.list) ? json.result!.list! : [];
  const parsed = list
    .map((item) => ({
      openInterest: String(item?.openInterest ?? ""),
      timestamp: Number(item?.timestamp),
    }))
    .filter((item) => item.openInterest && Number.isFinite(item.timestamp));
  const nextPageCursor = String(json?.result?.nextPageCursor ?? "").trim();
  return {
    list: parsed,
    ...(nextPageCursor ? { nextPageCursor } : {}),
  };
}

async function fetchFundingHistoryBatch(symbol: string, startMs: number, endMs: number): Promise<Array<{ fundingRate: string; fundingTs: number }>> {
  const out: Array<{ fundingRate: string; fundingTs: number }> = [];
  let currentEnd = endMs;
  let pages = 0;

  while (currentEnd > startMs) {
    const url = new URL(`${BYBIT_BASE_URL.replace(/\/+$/g, "")}/v5/market/funding/history`);
    url.searchParams.set("category", "linear");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("startTime", String(startMs));
    url.searchParams.set("endTime", String(currentEnd));
    url.searchParams.set("limit", "200");

    await limiter.acquire();
    const res = await fetch(url.toString(), { method: "GET" });
    const json = (await res.json()) as BybitFundingHistoryResponse;
    const retCode = Number(json?.retCode ?? 0);
    if (!(res.ok && retCode === 0)) {
      const msg = String(json?.retMsg ?? `http_${res.status}`);
      throw new Error(`funding_fetch_failed:${symbol}:${retCode}:${msg}`);
    }

    const list = Array.isArray(json?.result?.list) ? json.result!.list! : [];
    if (!list.length) break;

    let oldestTs = Number.POSITIVE_INFINITY;
    for (const item of list) {
      const fundingTs = Number(item?.fundingRateTimestamp);
      const fundingRate = String(item?.fundingRate ?? "");
      if (!Number.isFinite(fundingTs) || !fundingRate) continue;
      out.push({ fundingRate, fundingTs });
      if (fundingTs < oldestTs) oldestTs = fundingTs;
    }
    if (!Number.isFinite(oldestTs)) break;

    currentEnd = oldestTs - 1;
    pages += 1;
    if (pages % 5 === 0) await waitImmediate();
  }

  return out;
}

async function runReceiveJob(jobId: string, target: DatasetTarget) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    job.status = "running";
    job.startedAtMs = Date.now();
    const nowMs = job.startedAtMs;

    if (!target.universeId) {
      job.status = "error";
      job.error = toReceiveError("universe_not_selected", "Universe must be selected.");
      job.finishedAtMs = Date.now();
      return;
    }

    const resolvedRange = resolveRangeMs(target.range, nowMs);
    if (!resolvedRange || !(resolvedRange.endMs > resolvedRange.startMs) || resolvedRange.endMs - resolvedRange.startMs > MAX_RANGE_MS) {
      job.status = "error";
      job.error = toReceiveError("invalid_range", "Invalid dataset range.");
      job.finishedAtMs = Date.now();
      return;
    }

    const universe = readUniverse(target.universeId);
    const interval = normalizeBybitKlineInterval(target.interval);
    const klineBatchSpanMs = intervalToMs(interval) * REQUEST_LIMIT;
    const symbols = Array.isArray(universe.symbols) ? universe.symbols.filter((s) => typeof s === "string" && s.trim()) : [];
    const batchesPerSymbol = Math.max(1, Math.ceil((resolvedRange.endMs - resolvedRange.startMs) / klineBatchSpanMs));
    job.progress.totalSteps = Math.max(1, symbols.length * batchesPerSymbol);
    setProgress(job, { totalSteps: job.progress.totalSteps, message: "Starting receive." }, true);

    let completedSteps = 0;
    const symbolErrors: string[] = [];
    const failedSymbols = new Set<string>();
    let hasAnyOi = false;
    let hasAnyFunding = false;

    for (const symbol of symbols) {
      if (job.cancelRequested) break;

      const merged = loadSymbolCache(symbol, interval);
      setProgress(job, { currentSymbol: symbol, message: `Receiving ${symbol}` }, true);

      const oiIntervalTime = mapKlineIntervalToOiInterval(interval);
      const oiSamplesRaw: Array<{ openInterest: string; timestamp: number }> = [];
      let oiCursor: string | undefined;
      do {
        const page = await fetchOpenInterestPage(symbol, oiIntervalTime, resolvedRange.startMs, resolvedRange.endMs, oiCursor);
        oiSamplesRaw.push(...page.list);
        oiCursor = page.nextPageCursor;
      } while (oiCursor);
      const oiByTs = new Map<number, string>();
      for (const item of oiSamplesRaw) oiByTs.set(item.timestamp, item.openInterest);
      const oiSamples = Array.from(oiByTs.entries()).map(([timestamp, openInterest]) => ({ timestamp, openInterest }))
        .sort((a, b) => a.timestamp - b.timestamp);

      const fundingSamplesRaw = await fetchFundingHistoryBatch(symbol, resolvedRange.startMs, resolvedRange.endMs);
      const fundingByTs = new Map<number, string>();
      for (const item of fundingSamplesRaw) fundingByTs.set(item.fundingTs, item.fundingRate);
      const fundingSamples = Array.from(fundingByTs.entries()).map(([fundingTs, fundingRate]) => ({ fundingTs, fundingRate }))
        .sort((a, b) => a.fundingTs - b.fundingTs);

      let oiPtr = -1;
      let fundingPtr = -1;
      const candleMs = intervalToMs(interval);

      for (let cursor = resolvedRange.startMs; cursor < resolvedRange.endMs; cursor += klineBatchSpanMs) {
        if (job.cancelRequested) break;
        const batchEnd = Math.min(resolvedRange.endMs, cursor + klineBatchSpanMs - 1);
        try {
          const batch = await fetchKlinesBatch(symbol, interval, cursor, batchEnd);
          const sortedBatch = batch
            .map((row) => ({ row, startMs: Number(row?.[0]) }))
            .filter((item) => Number.isFinite(item.startMs))
            .sort((a, b) => a.startMs - b.startMs);

          for (const item of sortedBatch) {
            const row = item.row;
            const startMs = Number(row?.[0]);
            if (!Number.isFinite(startMs)) continue;

            const candleEndMs = startMs + candleMs - 1;
            while (oiPtr + 1 < oiSamples.length && oiSamples[oiPtr + 1]!.timestamp <= candleEndMs) oiPtr += 1;
            while (fundingPtr + 1 < fundingSamples.length && fundingSamples[fundingPtr + 1]!.fundingTs <= candleEndMs) fundingPtr += 1;

            const alignedOi = oiPtr >= 0 ? oiSamples[oiPtr]! : null;
            const alignedFunding = fundingPtr >= 0 ? fundingSamples[fundingPtr]! : null;

            const cacheRow: any = {
              symbol,
              startMs,
              open: String(row?.[1] ?? ""),
              high: String(row?.[2] ?? ""),
              low: String(row?.[3] ?? ""),
              close: String(row?.[4] ?? ""),
              volume: String(row?.[5] ?? ""),
              turnover: String(row?.[6] ?? ""),
            };
            if (alignedOi) {
              cacheRow.oi = alignedOi.openInterest;
              cacheRow.oiTs = alignedOi.timestamp;
              hasAnyOi = true;
            }
            if (alignedFunding) {
              cacheRow.fundingRate = alignedFunding.fundingRate;
              cacheRow.fundingTs = alignedFunding.fundingTs;
              hasAnyFunding = true;
            }
            merged.set(startMs, cacheRow);
          }
        } catch (e: any) {
          symbolErrors.push(`${symbol}: ${String(e?.message ?? e)}`);
          failedSymbols.add(symbol);
          break;
        }

        completedSteps += 1;
        setProgress(job, { completedSteps, currentSymbol: symbol });
      }

      writeSymbolCache(symbol, interval, merged);
      await waitImmediate();
    }

    if (job.cancelRequested) {
      job.status = "cancelled";
      job.finishedAtMs = Date.now();
      setProgress(job, { message: "Cancelled." }, true);
      return;
    }

    if (symbolErrors.length > 0) {
      setProgress(job, { message: `Completed with ${symbolErrors.length} symbol errors.` }, true);
    } else {
      setProgress(job, { message: "Completed." }, true);
    }

    job.status = "done";
    job.finishedAtMs = Date.now();
    setProgress(job, { completedSteps: job.progress.totalSteps, pct: 100 }, true);
    // best-effort: persist dataset history metadata (for optimizer selection)
    try {
      const okSymbols = symbols.filter((s) => !failedSymbols.has(s));
      const universeName = universe.meta?.name ?? target.universeId;
      upsertLatestDatasetHistory({
        id: jobId,
        universeId: target.universeId,
        universeName,
        startMs: resolvedRange.startMs,
        endMs: resolvedRange.endMs,
        receivedAtMs: job.finishedAtMs ?? Date.now(),
        interval,
        receivedSymbols: okSymbols,
        hasOi: hasAnyOi,
        hasFunding: hasAnyFunding,
      });
    } catch {
      // ignore
    }

  } catch (e: any) {
    job.status = "error";
    job.error = toReceiveError("receive_failed", String(e?.message ?? e));
    job.finishedAtMs = Date.now();
    setProgress(job, { message: "Receive failed." }, true);
  }
}

export function startReceiveDataJob(input?: Partial<DatasetTarget>) {
  const persisted = readDatasetTarget();
  const target: DatasetTarget = {
    universeId: typeof input?.universeId === "string" || input?.universeId === null ? input.universeId : persisted.universeId,
    range: input?.range ?? persisted.range,
    interval: normalizeBybitKlineInterval((input as any)?.interval ?? persisted.interval),
    updatedAtMs: Date.now(),
  };

  if (!target.universeId) return { error: "universe_not_selected" as const };
  const resolved = resolveRangeMs(target.range, Date.now());
  if (!resolved || !(resolved.endMs > resolved.startMs) || resolved.endMs - resolved.startMs > MAX_RANGE_MS) {
    return { error: "invalid_range" as const };
  }

  writeDatasetTarget(target);

  const id = randomUUID();
  jobs.set(id, {
    id,
    status: "queued",
    progress: { pct: 0, completedSteps: 0, totalSteps: 1 },
    cancelRequested: false,
    lastProgressEmitMs: 0,
  });

  setImmediate(() => {
    void runReceiveJob(id, target);
  });

  return { jobId: id };
}

export function getReceiveDataJob(jobId: string): ReceiveJobView | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    ...(typeof job.startedAtMs === "number" ? { startedAtMs: job.startedAtMs } : {}),
    ...(typeof job.finishedAtMs === "number" ? { finishedAtMs: job.finishedAtMs } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

export function cancelReceiveDataJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.cancelRequested = true;
  if (job.status === "queued") {
    job.status = "cancelled";
    job.finishedAtMs = Date.now();
  }
  return true;
}
