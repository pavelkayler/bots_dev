import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readDatasetTarget, type DatasetRangePreset, type DatasetTarget } from "../dataset/datasetTargetStore.js";
import { readUniverse } from "../universe/universeStore.js";

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

const BYBIT_BASE_URL = process.env.BYBIT_REST_URL ?? "https://api.bybit.com";
const INTERVAL_MINUTES = 1;
const REQUEST_LIMIT = 1000;
const WINDOW_MS = INTERVAL_MINUTES * 60_000 * REQUEST_LIMIT;
const PROGRESS_THROTTLE_MS = 80;
const MAX_RANGE_MS = 180 * 24 * 60 * 60 * 1000;
const CACHE_DIR = path.resolve(process.cwd(), "data", "cache", "bybit_klines");

const jobs = new Map<string, ReceiveJobInternal>();

class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private queue: number[] = [];

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async acquire() {
    while (true) {
      const now = Date.now();
      this.queue = this.queue.filter((ts) => now - ts < this.windowMs);
      if (this.queue.length < this.maxRequests) {
        this.queue.push(now);
        return;
      }
      const oldest = this.queue[0] ?? now;
      const waitMs = Math.max(10, this.windowMs - (now - oldest));
      await sleep(waitMs);
    }
  }
}

const limiter = new RateLimiter(350, 5000);

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

function loadSymbolCache(symbol: string): Map<number, any> {
  const out = new Map<number, any>();
  const fp = path.join(CACHE_DIR, `${symbol}.jsonl`);
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

function writeSymbolCache(symbol: string, rows: Map<number, any>) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const sorted = Array.from(rows.entries()).sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  const body = sorted.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(path.join(CACHE_DIR, `${symbol}.jsonl`), body ? `${body}\n` : "", "utf8");
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

async function fetchKlinesBatch(symbol: string, startMs: number, endMs: number): Promise<string[][]> {
  const url = new URL(`${BYBIT_BASE_URL.replace(/\/+$/g, "")}/v5/market/kline`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1");
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
    const symbols = Array.isArray(universe.symbols) ? universe.symbols.filter((s) => typeof s === "string" && s.trim()) : [];
    const batchesPerSymbol = Math.max(1, Math.ceil((resolvedRange.endMs - resolvedRange.startMs) / WINDOW_MS));
    job.progress.totalSteps = Math.max(1, symbols.length * batchesPerSymbol);
    setProgress(job, { totalSteps: job.progress.totalSteps, message: "Starting receive." }, true);

    let completedSteps = 0;
    const symbolErrors: string[] = [];

    for (const symbol of symbols) {
      if (job.cancelRequested) break;

      const merged = loadSymbolCache(symbol);
      setProgress(job, { currentSymbol: symbol, message: `Receiving ${symbol}` }, true);

      for (let cursor = resolvedRange.startMs; cursor < resolvedRange.endMs; cursor += WINDOW_MS) {
        if (job.cancelRequested) break;
        const batchEnd = Math.min(resolvedRange.endMs, cursor + WINDOW_MS - 1);
        try {
          const batch = await fetchKlinesBatch(symbol, cursor, batchEnd);
          for (const row of batch) {
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
          break;
        }

        completedSteps += 1;
        setProgress(job, { completedSteps, currentSymbol: symbol });
      }

      writeSymbolCache(symbol, merged);
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
    updatedAtMs: Date.now(),
  };

  if (!target.universeId) return { error: "universe_not_selected" as const };
  const resolved = resolveRangeMs(target.range, Date.now());
  if (!resolved || !(resolved.endMs > resolved.startMs) || resolved.endMs - resolved.startMs > MAX_RANGE_MS) {
    return { error: "invalid_range" as const };
  }

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
