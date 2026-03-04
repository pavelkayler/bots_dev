import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  readDatasetTarget,
  writeDatasetTarget,
  type DatasetRangePreset,
  type DatasetTarget,
  type BybitKlineInterval,
  normalizeBybitKlineInterval,
} from "../dataset/datasetTargetStore.js";
import { readUniverse } from "../universe/universeStore.js";
import { setDatasetHistoryManifestSummary, upsertLatestDatasetHistory, type DatasetHistoryManifestSummary } from "./datasetHistoryStore.js";

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

type OiIntervalTime = "5min";

type BybitFundingHistoryItem = {
  fundingRate?: string;
  fundingRateTimestamp?: string;
};

type BybitFundingHistoryResponse = {
  retCode?: number;
  retMsg?: string;
  result?: {
    list?: BybitFundingHistoryItem[];
  };
};

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
const OI_CACHE_DIR = path.resolve(process.cwd(), "data", "cache", "bybit_open_interest", "5min");
const FUNDING_CACHE_DIR = path.resolve(process.cwd(), "data", "cache", "bybit_funding_history");
const FUNDING_STEP_MS = 8 * 60 * 60_000;
const MANIFEST_DIR = path.resolve(process.cwd(), "data", "cache", "manifests");

type QaSeriesStats = {
  expected: number;
  present: number;
  coveragePct: number;
  missing: Array<[number, number]>;
  duplicates: number;
  outOfOrder: number;
  gaps: number;
  minTs: number;
  maxTs: number;
  sha256: string;
};

type DatasetManifest = {
  historyId: string;
  universe: string;
  range: { startMs: number; endMs: number };
  generatedAtMs: number;
  symbols: Record<string, {
    kline1m: QaSeriesStats;
    oi5m: QaSeriesStats;
    funding: {
      points: number;
      minTs: number;
      maxTs: number;
      coverageNote: string;
      missingPoints: number;
      sha256: string;
    };
  }>;
  summary: {
    symbols: number;
    kline1mCoveragePct: number;
    oi5mCoveragePct: number;
    status: "ok" | "partial" | "bad";
    coveragePct: number;
    missing1mCandlesTotal: number;
    missingOi5mPointsTotal: number;
    missingFundingPointsTotal: number;
    duplicatesTotal: number;
    outOfOrderTotal: number;
  };
};

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

function oiCachePath(symbol: string): string {
  return path.join(OI_CACHE_DIR, `${symbol}.jsonl`);
}

function loadOiCache(symbol: string): Map<number, string> {
  const out = new Map<number, string>();
  const fp = oiCachePath(symbol);
  if (!fs.existsSync(fp)) return out;
  const raw = fs.readFileSync(fp, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { timestamp?: number; openInterest?: string };
      const timestamp = Number(row?.timestamp);
      const openInterest = String(row?.openInterest ?? "");
      if (!Number.isFinite(timestamp) || !openInterest) continue;
      out.set(timestamp, openInterest);
    } catch {
      continue;
    }
  }
  return out;
}

function writeOiCache(symbol: string, rows: Map<number, string>) {
  fs.mkdirSync(OI_CACHE_DIR, { recursive: true });
  const sorted = Array.from(rows.entries()).sort((a, b) => a[0] - b[0]);
  const body = sorted.map(([timestamp, openInterest]) => JSON.stringify({ timestamp, openInterest })).join("\n");
  fs.writeFileSync(oiCachePath(symbol), body ? `${body}\n` : "", "utf8");
}


function fundingCachePath(symbol: string): string {
  return path.join(FUNDING_CACHE_DIR, `${symbol}.jsonl`);
}

function loadFundingCache(symbol: string): Map<number, string> {
  const out = new Map<number, string>();
  const fp = fundingCachePath(symbol);
  if (!fs.existsSync(fp)) return out;
  const raw = fs.readFileSync(fp, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { timestamp?: number; fundingRate?: string };
      const timestamp = Number(row?.timestamp);
      const fundingRate = String(row?.fundingRate ?? "");
      if (!Number.isFinite(timestamp) || !fundingRate) continue;
      out.set(timestamp, fundingRate);
    } catch {
      continue;
    }
  }
  return out;
}

function writeFundingCache(symbol: string, rows: Map<number, string>) {
  fs.mkdirSync(FUNDING_CACHE_DIR, { recursive: true });
  const sorted = Array.from(rows.entries()).sort((a, b) => a[0] - b[0]);
  const body = sorted.map(([timestamp, fundingRate]) => JSON.stringify({ timestamp, fundingRate })).join("\n");
  fs.writeFileSync(fundingCachePath(symbol), body ? `${body}\n` : "", "utf8");
}

function alignToStep(ms: number, stepMs: number): number {
  return Math.floor(ms / stepMs) * stepMs;
}

function expectedTimestampsInRange(startMs: number, endMs: number, stepMs: number): number[] {
  const out: number[] = [];
  let ts = alignToStep(startMs, stepMs);
  if (ts < startMs) ts += stepMs;
  for (; ts <= endMs; ts += stepMs) out.push(ts);
  return out;
}

function computeMissingWindows(
  existing: Set<number>,
  startMs: number,
  endMs: number,
  stepMs: number
): Array<{ startMs: number; endMs: number }> {
  const expected = expectedTimestampsInRange(startMs, endMs, stepMs);
  const windows: Array<{ startMs: number; endMs: number }> = [];
  let windowStart: number | null = null;
  let prevMissing: number | null = null;
  for (const ts of expected) {
    if (existing.has(ts)) continue;
    if (windowStart == null) {
      windowStart = ts;
      prevMissing = ts;
      continue;
    }
    if (prevMissing != null && ts === prevMissing + stepMs) {
      prevMissing = ts;
      continue;
    }
    windows.push({ startMs: windowStart, endMs: prevMissing ?? windowStart });
    windowStart = ts;
    prevMissing = ts;
  }
  if (windowStart != null) windows.push({ startMs: windowStart, endMs: prevMissing ?? windowStart });
  return windows;
}

function roundPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function sha256FromParts(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function parseJsonlRows<T>(fp: string, parseLine: (value: unknown) => T | null): T[] {
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, "utf8");
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = parseLine(JSON.parse(line));
      if (parsed) out.push(parsed);
    } catch {
      continue;
    }
  }
  return out;
}

function computeSeriesQa(
  timestamps: number[],
  valueByTs: Map<number, string>,
  startMs: number,
  endMs: number,
  stepMs: number,
  partsForHash: (ts: number) => string
): QaSeriesStats {
  let duplicates = 0;
  let outOfOrder = 0;
  let prevTs: number | null = null;
  const presentSet = new Set<number>();
  let minTs = 0;
  let maxTs = 0;

  for (const ts of timestamps) {
    if (!Number.isFinite(ts) || ts < startMs || ts > endMs) continue;
    if (prevTs != null && ts < prevTs) outOfOrder += 1;
    prevTs = ts;
    if (presentSet.has(ts)) {
      duplicates += 1;
      continue;
    }
    presentSet.add(ts);
    if (minTs === 0 || ts < minTs) minTs = ts;
    if (maxTs === 0 || ts > maxTs) maxTs = ts;
  }

  const expected = expectedTimestampsInRange(startMs, endMs, stepMs);
  const missingWindows = computeMissingWindows(presentSet, startMs, endMs, stepMs);
  const present = presentSet.size;
  const coveragePct = expected.length === 0 ? 100 : roundPct((present / expected.length) * 100);
  const sortedTs = Array.from(presentSet).sort((a, b) => a - b);
  const hashParts: string[] = [];
  for (const ts of sortedTs) {
    if (!valueByTs.has(ts)) continue;
    hashParts.push(partsForHash(ts));
  }

  return {
    expected: expected.length,
    present,
    coveragePct,
    missing: missingWindows.map((w) => [w.startMs, w.endMs]),
    duplicates,
    outOfOrder,
    gaps: missingWindows.length,
    minTs,
    maxTs,
    sha256: sha256FromParts(hashParts),
  };
}

function writeManifestFile(historyId: string, manifest: DatasetManifest) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(MANIFEST_DIR, `${historyId}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function buildDatasetManifest(input: {
  historyId: string;
  universeName: string;
  startMs: number;
  endMs: number;
  symbols: string[];
}): { manifest: DatasetManifest; summary: DatasetHistoryManifestSummary } {
  const symbolStats: DatasetManifest["symbols"] = {};
  let klineExpectedTotal = 0;
  let klinePresentTotal = 0;
  let oiExpectedTotal = 0;
  let oiPresentTotal = 0;
  let fundingExpectedTotal = 0;
  let fundingPresentTotal = 0;
  let duplicatesTotal = 0;
  let outOfOrderTotal = 0;
  let allSymbolsPerfect = true;
  let hasSymbolBelowNinety = false;

  for (const symbol of input.symbols) {
    const klineRows = parseJsonlRows(resolveReadCachePath(symbol, "1"), (value) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const startMs = Number(row.startMs);
      const close = String(row.close ?? "");
      if (!Number.isFinite(startMs) || !close) return null;
      return { ts: startMs, value: close };
    });
    const klineValueByTs = new Map<number, string>();
    for (const row of klineRows) if (row.ts >= input.startMs && row.ts <= input.endMs) klineValueByTs.set(row.ts, row.value);
    const klineQa = computeSeriesQa(
      klineRows.map((r) => r.ts),
      klineValueByTs,
      input.startMs,
      input.endMs,
      60_000,
      (ts) => `${ts}:${klineValueByTs.get(ts) ?? ""}\n`
    );

    const oiRows = parseJsonlRows(oiCachePath(symbol), (value) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const ts = Number(row.timestamp);
      const oi = String(row.openInterest ?? "");
      if (!Number.isFinite(ts) || !oi) return null;
      return { ts, value: oi };
    });
    const oiValueByTs = new Map<number, string>();
    for (const row of oiRows) if (row.ts >= input.startMs && row.ts <= input.endMs) oiValueByTs.set(row.ts, row.value);
    const oiQa = computeSeriesQa(
      oiRows.map((r) => r.ts),
      oiValueByTs,
      input.startMs,
      input.endMs,
      300_000,
      (ts) => `${ts}:${oiValueByTs.get(ts) ?? ""}\n`
    );

    const fundingRows = parseJsonlRows(fundingCachePath(symbol), (value) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const ts = Number(row.timestamp);
      const fundingRate = String(row.fundingRate ?? "");
      if (!Number.isFinite(ts) || !fundingRate) return null;
      return { ts, value: fundingRate };
    });
    const fundingValueByTs = new Map<number, string>();
    let fundingMinTs = 0;
    let fundingMaxTs = 0;
    for (const row of fundingRows) {
      if (row.ts < input.startMs || row.ts > input.endMs) continue;
      fundingValueByTs.set(row.ts, row.value);
      if (fundingMinTs === 0 || row.ts < fundingMinTs) fundingMinTs = row.ts;
      if (fundingMaxTs === 0 || row.ts > fundingMaxTs) fundingMaxTs = row.ts;
    }
    const fundingExpected = expectedTimestampsInRange(input.startMs, input.endMs, FUNDING_STEP_MS).length;
    const fundingPresent = fundingValueByTs.size;

    symbolStats[symbol] = {
      kline1m: klineQa,
      oi5m: oiQa,
      funding: {
        points: fundingPresent,
        minTs: fundingMinTs,
        maxTs: fundingMaxTs,
        coverageNote: "last-known held between fundingRateTimestamp points",
        missingPoints: Math.max(0, fundingExpected - fundingPresent),
        sha256: sha256FromParts(
          Array.from(fundingValueByTs.keys()).sort((a, b) => a - b).map((ts) => `${ts}:${fundingValueByTs.get(ts) ?? ""}\n`)
        ),
      },
    };

    klineExpectedTotal += klineQa.expected;
    klinePresentTotal += klineQa.present;
    oiExpectedTotal += oiQa.expected;
    oiPresentTotal += oiQa.present;
    fundingExpectedTotal += fundingExpected;
    fundingPresentTotal += fundingPresent;
    duplicatesTotal += klineQa.duplicates + oiQa.duplicates;
    outOfOrderTotal += klineQa.outOfOrder + oiQa.outOfOrder;

    if (!(klineQa.coveragePct === 100 && oiQa.coveragePct === 100)) allSymbolsPerfect = false;
    if (klineQa.coveragePct < 90 || oiQa.coveragePct < 90) hasSymbolBelowNinety = true;
  }

  const klineCoveragePct = klineExpectedTotal === 0 ? 100 : roundPct((klinePresentTotal / klineExpectedTotal) * 100);
  const oiCoveragePct = oiExpectedTotal === 0 ? 100 : roundPct((oiPresentTotal / oiExpectedTotal) * 100);
  const combinedExpected = klineExpectedTotal + oiExpectedTotal;
  const combinedPresent = klinePresentTotal + oiPresentTotal;
  const coveragePct = combinedExpected === 0 ? 100 : roundPct((combinedPresent / combinedExpected) * 100);

  let status: "ok" | "partial" | "bad" = "partial";
  if (allSymbolsPerfect && duplicatesTotal === 0 && outOfOrderTotal === 0) {
    status = "ok";
  } else if (coveragePct < 95 || duplicatesTotal > 0 || outOfOrderTotal > 0 || hasSymbolBelowNinety) {
    status = "bad";
  }

  const generatedAtMs = Date.now();
  const summary = {
    symbols: input.symbols.length,
    kline1mCoveragePct: klineCoveragePct,
    oi5mCoveragePct: oiCoveragePct,
    status,
    coveragePct,
    missing1mCandlesTotal: Math.max(0, klineExpectedTotal - klinePresentTotal),
    missingOi5mPointsTotal: Math.max(0, oiExpectedTotal - oiPresentTotal),
    missingFundingPointsTotal: Math.max(0, fundingExpectedTotal - fundingPresentTotal),
    duplicatesTotal,
    outOfOrderTotal,
  };

  return {
    manifest: {
      historyId: input.historyId,
      universe: input.universeName,
      range: { startMs: input.startMs, endMs: input.endMs },
      generatedAtMs,
      symbols: symbolStats,
      summary,
    },
    summary: {
      status: summary.status,
      updatedAt: generatedAtMs,
      coveragePct: summary.coveragePct,
      missing1mCandlesTotal: summary.missing1mCandlesTotal,
      missingOi5mPointsTotal: summary.missingOi5mPointsTotal,
      missingFundingPointsTotal: summary.missingFundingPointsTotal,
      duplicatesTotal: summary.duplicatesTotal,
      outOfOrderTotal: summary.outOfOrderTotal,
    },
  };
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
  const total = Math.max(0, Math.floor(Number(job.progress.totalSteps) || 0));
  const clampedCompleted = Math.min(total, Math.max(0, Math.floor(Number(job.progress.completedSteps) || 0)));
  job.progress.totalSteps = total;
  job.progress.completedSteps = clampedCompleted;
  job.progress.pct = total === 0 ? 100 : Math.floor((clampedCompleted / total) * 100);
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


async function fetchFundingHistoryWindow(
  symbol: string,
  startMs: number,
  endMs: number
): Promise<Array<{ fundingRate: string; timestamp: number }>> {
  const url = new URL(`${BYBIT_BASE_URL.replace(/\/+$/g, "")}/v5/market/funding/history`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("startTime", String(startMs));
  url.searchParams.set("endTime", String(endMs));
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
  return list
    .map((item) => ({
      fundingRate: String(item?.fundingRate ?? ""),
      timestamp: Number(item?.fundingRateTimestamp),
    }))
    .filter((item) => item.fundingRate && Number.isFinite(item.timestamp));
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
    const baseKlineInterval: BybitKlineInterval = "1";
    const symbols = Array.isArray(universe.symbols) ? universe.symbols.filter((s) => typeof s === "string" && s.trim()) : [];

    const klineWindowsBySymbol = new Map<string, Array<{ startMs: number; endMs: number }>>();
    const oiWindowsBySymbol = new Map<string, Array<{ startMs: number; endMs: number }>>();
    const fundingWindowsBySymbol = new Map<string, Array<{ startMs: number; endMs: number }>>();
    const mergedBySymbol = new Map<string, Map<number, any>>();
    const oiBySymbol = new Map<string, Map<number, string>>();
    const fundingBySymbol = new Map<string, Map<number, string>>();
    const oiIntervalMs = 5 * 60_000;
    const oiIntervalTime: OiIntervalTime = "5min";

    let totalSteps = 0;
    for (const symbol of symbols) {
      const merged = loadSymbolCache(symbol, baseKlineInterval);
      mergedBySymbol.set(symbol, merged);
      const klineMissingWindows = computeMissingWindows(new Set(merged.keys()), resolvedRange.startMs, resolvedRange.endMs, intervalToMs(baseKlineInterval));
      const klineRequestWindows: Array<{ startMs: number; endMs: number }> = [];
      const chunkMs = intervalToMs(baseKlineInterval) * REQUEST_LIMIT;
      for (const window of klineMissingWindows) {
        for (let cursor = window.startMs; cursor <= window.endMs; cursor += chunkMs) {
          const batchEndStartMs = Math.min(window.endMs, cursor + chunkMs - intervalToMs(baseKlineInterval));
          klineRequestWindows.push({ startMs: cursor, endMs: batchEndStartMs });
        }
      }
      klineWindowsBySymbol.set(symbol, klineRequestWindows);
      totalSteps += klineRequestWindows.length;

      const oiMap = loadOiCache(symbol);
      oiBySymbol.set(symbol, oiMap);
      const oiMissingWindows = computeMissingWindows(new Set(oiMap.keys()), resolvedRange.startMs, resolvedRange.endMs, oiIntervalMs);
      oiWindowsBySymbol.set(symbol, oiMissingWindows);
      totalSteps += oiMissingWindows.length;

      const fundingMap = loadFundingCache(symbol);
      fundingBySymbol.set(symbol, fundingMap);
      const fundingMissingWindows = computeMissingWindows(new Set(fundingMap.keys()), resolvedRange.startMs, resolvedRange.endMs, FUNDING_STEP_MS);
      fundingWindowsBySymbol.set(symbol, fundingMissingWindows);
      totalSteps += fundingMissingWindows.length;
    }

    setProgress(job, { totalSteps, completedSteps: 0, message: "Starting receive." }, true);

    let completedSteps = 0;
    const symbolErrors: string[] = [];
    const failedSymbols = new Set<string>();
    let hasAnyOi = false;
    let hasAnyFunding = false;

    for (const symbol of symbols) {
      if (job.cancelRequested) break;
      setProgress(job, { currentSymbol: symbol, message: `Receiving ${symbol}` }, true);

      const merged = mergedBySymbol.get(symbol) ?? loadSymbolCache(symbol, baseKlineInterval);
      const klineWindows = klineWindowsBySymbol.get(symbol) ?? [];
      for (const window of klineWindows) {
        if (job.cancelRequested) break;
        try {
          const fetchStart = window.startMs;
          const fetchEnd = window.endMs + intervalToMs(baseKlineInterval) - 1;
          const batch = await fetchKlinesBatch(symbol, baseKlineInterval, fetchStart, fetchEnd);
          const sortedBatch = batch
            .map((row) => ({ row, startMs: Number(row?.[0]) }))
            .filter((item) => Number.isFinite(item.startMs))
            .sort((a, b) => a.startMs - b.startMs);
          for (const item of sortedBatch) {
            const row = item.row;
            const startMs = Number(row?.[0]);
            if (!Number.isFinite(startMs)) continue;
            merged.set(startMs, {
              symbol,
              startMs,
              open: String(row?.[1] ?? ""),
              high: String(row?.[2] ?? ""),
              low: String(row?.[3] ?? ""),
              close: String(row?.[4] ?? ""),
              volume: String(row?.[5] ?? ""),
              turnover: String(row?.[6] ?? ""),
            });
          }
        } catch (e: any) {
          symbolErrors.push(`${symbol}: ${String(e?.message ?? e)}`);
          failedSymbols.add(symbol);
          break;
        }
        completedSteps += 1;
        setProgress(job, { completedSteps, currentSymbol: symbol });
      }

      const oiMap = oiBySymbol.get(symbol) ?? loadOiCache(symbol);
      const oiMissingWindows = oiWindowsBySymbol.get(symbol) ?? [];
      for (const window of oiMissingWindows) {
        if (job.cancelRequested) break;
        try {
          let cursor: string | undefined;
          do {
            const page = await fetchOpenInterestPage(symbol, oiIntervalTime, window.startMs, window.endMs, cursor);
            for (const item of page.list) oiMap.set(item.timestamp, item.openInterest);
            cursor = page.nextPageCursor;
          } while (cursor);
        } catch (e: any) {
          symbolErrors.push(`${symbol}: ${String(e?.message ?? e)}`);
          failedSymbols.add(symbol);
          break;
        }
        completedSteps += 1;
        setProgress(job, { completedSteps, currentSymbol: symbol });
      }
      writeOiCache(symbol, oiMap);
      const oiSamples = Array.from(oiMap.entries())
        .map(([timestamp, openInterest]) => ({ timestamp, openInterest }))
        .sort((a, b) => a.timestamp - b.timestamp);
      if (oiSamples.length > 0) hasAnyOi = true;

      const fundingMap = fundingBySymbol.get(symbol) ?? loadFundingCache(symbol);
      const fundingMissingWindows = fundingWindowsBySymbol.get(symbol) ?? [];
      for (const window of fundingMissingWindows) {
        if (job.cancelRequested) break;
        try {
          const points = await fetchFundingHistoryWindow(symbol, window.startMs, window.endMs);
          for (const point of points) fundingMap.set(point.timestamp, point.fundingRate);
        } catch (e: any) {
          symbolErrors.push(`${symbol}: ${String(e?.message ?? e)}`);
          failedSymbols.add(symbol);
          break;
        }
        completedSteps += 1;
        setProgress(job, { completedSteps, currentSymbol: symbol });
      }
      writeFundingCache(symbol, fundingMap);
      if (fundingMap.size > 0) hasAnyFunding = true;

      const startKeys = Array.from(merged.keys()).sort((a, b) => a - b);
      let oiPtr = -1;
      for (const startMs of startKeys) {
        if (startMs < resolvedRange.startMs || startMs > resolvedRange.endMs) continue;
        const candleEndMs = startMs + intervalToMs(baseKlineInterval) - 1;
        while (oiPtr + 1 < oiSamples.length && oiSamples[oiPtr + 1]!.timestamp <= candleEndMs) oiPtr += 1;
        const row = merged.get(startMs);
        if (!row) continue;
        if (oiPtr >= 0) {
          const aligned = oiSamples[oiPtr]!;
          row.oi = aligned.openInterest;
          row.oiTs = aligned.timestamp;
        } else {
          delete row.oi;
          delete row.oiTs;
        }
      }
      writeSymbolCache(symbol, baseKlineInterval, merged);
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
        interval: baseKlineInterval,
        receivedSymbols: okSymbols,
        hasOi: hasAnyOi,
        hasFunding: hasAnyFunding,
      });
      const { manifest, summary } = buildDatasetManifest({
        historyId: jobId,
        universeName,
        startMs: resolvedRange.startMs,
        endMs: resolvedRange.endMs,
        symbols: okSymbols,
      });
      writeManifestFile(jobId, manifest);
      setDatasetHistoryManifestSummary(jobId, summary);
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
    interval: normalizeBybitKlineInterval((input as any)?.interval ?? "15"),
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
