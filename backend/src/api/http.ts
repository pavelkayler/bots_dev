import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runtime } from "../runtime/runtime.js";
import { CONFIG } from "../config.js";
import { configStore } from "../runtime/configStore.js";
import { deleteUniverse, listUniverses, readUniverse, writeUniverse, formatUniverseName } from "../universe/universeStore.js";
import { buildUniverseByTickersWs } from "../universe/universeBuilder.js";
import { seedLinearUsdtPerpSymbols } from "../universe/universeSeed.js";
import * as paperSummary from "../paper/summary.js";
type SessionSummaryResponse = any;
import { deletePreset, listPresets, putPreset, readPreset } from "../presets/presetStore.js";
import { getOptimizerSettings, getTapeSizeBytes, listTapeSegments, listTapes, safeId, setOptimizerSettings } from "../optimizer/tapeStore.js";
import { incrementTapeRuns } from "../optimizer/tapeRunsStore.js";
import { readLoopState, recoverLoopStateOnBoot, type OptimizerLoopRunPayload, type OptimizerLoopState, writeLoopState } from "../optimizer/loopStore.js";
import { tapeRecorder } from "../optimizer/tapeRecorder.js";
import {
  DEFAULT_OPTIMIZER_PRECISION,
  type OptimizerSimulationParams,
  sortOptimizationResults,
  type OptimizerPrecision,
  type OptimizerRanges,
  type OptimizerResult,
  type OptimizerSortDir,
  type OptimizerSortKey,
} from "../optimizer/runner.js";
import { optimizerWorkerManager } from "../optimizer/worker/workerManager.js";
import { getDataDirPath, isLowDiskBestEffort, MIN_FREE_BYTES, readFreeBytesBestEffort } from "../utils/diskGuard.js";
import { BybitDemoRestClient } from "../bybit/BybitDemoRestClient.js";
import { readDatasetTarget, writeDatasetTarget, normalizeDatasetTarget } from "../dataset/datasetTargetStore.js";
import { cancelReceiveDataJob, getReceiveDataJob, startReceiveDataJob } from "../dataset/receiveDataStore.js";

type OptimizerJob = {
  status: "running" | "paused" | "done" | "error" | "cancelled";
  total: number;
  done: number;
  lastPct: number;
  cancelRequested: boolean;
  pauseRequested: boolean;
  paused: boolean;
  resumeRequested: boolean;
  message?: string;
  results: OptimizerResult[];
  minTrades: number;
  startedAtMs: number;
  updatedAtMs: number;
  processedCandidates: number;
  totalCandidates: number;
  excludeNegative: boolean;
  rememberNegatives: boolean;
  runKey: string;
  finishedAtMs: number | null;
  runPayload: Record<string, unknown> | null;
};

type DatasetMode = "snapshot" | "followTail";

type SnapshotDescriptor = {
  datasetMode: "snapshot";
  tapeFiles: Array<{ tapeId: string; bytes: number }>;
  timeRangeFromTs?: number;
  timeRangeToTs?: number;
};

type FollowTailDescriptor = {
  datasetMode: "followTail";
  baseTapeIds: string[];
  explicitTapeIds: string[];
  timeRangeFromTs?: number;
  timeRangeToTs?: number;
};

type OptimizerCheckpoint = {
  jobId: string;
  createdAt: number;
  updatedAt: number;
  status: OptimizerJob["status"];
  donePercent: number;
  processedCandidates: number;
  totalCandidates: number;
  topKResults: OptimizerResult[];
  message?: string;
  minTrades: number;
  startedAtMs: number;
  excludeNegative: boolean;
  rememberNegatives: boolean;
  runKey: string;
  finishedAtMs: number | null;
};

type OptimizerJobSnapshot = {
  jobId: string;
  status: OptimizerJob["status"];
  startedAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
  runPayload: Record<string, unknown> | null;
  results: OptimizerResult[];
  message?: string;
};

type OptimizerJobHistoryRecord = {
  jobId: string;
  mode?: "loop" | "single";
  endedAtMs: number;
  status: "done" | "cancelled" | "error" | "stopped";
  runPayload: {
    tapeIds: string[];
    optTfMin?: number;
    timeRangeFromTs?: number;
    timeRangeToTs?: number;
    candidates: number;
    seed: number;
    minTrades: number;
    directionMode: "both" | "long" | "short";
    rememberNegatives: boolean;
    excludeNegative: boolean;
    sim?: OptimizerSimulationParams;
  };
  summary: {
    bestNetPnl: number | null;
    bestTrades: number | null;
    bestWinRate: number | null;
    bestProfitFactor: number | null;
    bestMaxDD: number | null;
    rowsPositive: number;
    rowsTotal: number;
  };
};

const optimizerJobs = new Map<string, OptimizerJob>();
const optimizerJobStartedAt = new Map<string, number>();
let latestOptimizerJobId: string | null = null;
const checkpointDir = path.resolve(process.cwd(), "data/optimizer_checkpoints");
const optimizerJobsDir = path.resolve(process.cwd(), "data/optimizer_jobs");
const optimizerBlacklistsDir = path.resolve(process.cwd(), "data/optimizer_blacklists");
const MAX_CHECKPOINT_FILES = 5;
const MIN_CHECKPOINT_INTERVAL_MS = 2_000;
const SOAK_SNAPSHOT_PATH = path.resolve(process.cwd(), "data", "soak_snapshots.jsonl");
const OPTIMIZER_JOB_HISTORY_PATH = path.resolve(process.cwd(), "data", "optimizer_job_history.json");
const dataDir = getDataDirPath();
let lastSoakSnapshot: any = null;
const lastCheckpointWriteMs = new Map<string, number>();
const lastSnapshotWriteMs = new Map<string, number>();
let optimizerLoopState: OptimizerLoopState | null = recoverLoopStateOnBoot() ?? readLoopState();
let shutdownHandler: (() => Promise<void> | void) | null = null;
const tapeBoundsCache = new Map<string, { signature: string; startTs: number | null; endTs: number | null }>();

function toBaseTapeId(tapeId: string): string {
  const match = tapeId.match(/^(.*)-seg\d+$/);
  return match?.[1] ? match[1] : tapeId;
}

function readTapeBounds(baseTapeId: string): { startTs: number | null; endTs: number | null } {
  const tapesDir = getOptimizerSettings().tapesDir;
  const segmentIds = listTapeSegments(baseTapeId);
  const signatureParts: string[] = [];
  for (const segmentId of segmentIds) {
    const segmentPath = path.join(tapesDir, `${segmentId}.jsonl`);
    try {
      const stat = fs.statSync(segmentPath);
      signatureParts.push(`${segmentId}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    } catch {
      continue;
    }
  }
  const signature = signatureParts.join("|");
  const cached = tapeBoundsCache.get(baseTapeId);
  if (cached && cached.signature === signature) {
    return { startTs: cached.startTs, endTs: cached.endTs };
  }

  let startTs: number | null = null;
  let endTs: number | null = null;

  for (const segmentId of segmentIds) {
    const segmentPath = path.join(tapesDir, `${segmentId}.jsonl`);
    let raw = "";
    try {
      raw = fs.readFileSync(segmentPath, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as { type?: string; ts?: unknown };
        if (row?.type === "meta") continue;
        const tsRaw = Number(row?.ts);
        if (!Number.isFinite(tsRaw) || tsRaw <= 0) continue;
        const tsMs = tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
        if (startTs == null || tsMs < startTs) startTs = tsMs;
        if (endTs == null || tsMs > endTs) endTs = tsMs;
      } catch {
        continue;
      }
    }
  }

  tapeBoundsCache.set(baseTapeId, { signature, startTs, endTs });
  return { startTs, endTs };
}

function readOptimizerJobHistory(): OptimizerJobHistoryRecord[] {
  if (!fs.existsSync(OPTIMIZER_JOB_HISTORY_PATH)) return [];
  try {
    const raw = fs.readFileSync(OPTIMIZER_JOB_HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as OptimizerJobHistoryRecord[] : [];
  } catch {
    return [];
  }
}

function readOptimizerJobHistoryRaw(): unknown[] {
  if (!fs.existsSync(OPTIMIZER_JOB_HISTORY_PATH)) return [];
  try {
    const raw = fs.readFileSync(OPTIMIZER_JOB_HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOptimizerJobHistory(records: OptimizerJobHistoryRecord[]) {
  fs.mkdirSync(path.dirname(OPTIMIZER_JOB_HISTORY_PATH), { recursive: true });
  writeFileAtomic(OPTIMIZER_JOB_HISTORY_PATH, `${JSON.stringify(records, null, 2)}\n`);
}

function writeOptimizerJobHistoryRaw(records: unknown[]) {
  fs.mkdirSync(path.dirname(OPTIMIZER_JOB_HISTORY_PATH), { recursive: true });
  writeFileAtomic(OPTIMIZER_JOB_HISTORY_PATH, `${JSON.stringify(records, null, 2)}\n`);
}

function getHistoryRecordId(record: unknown): string {
  if (!record || typeof record !== "object") return "";
  const row = record as Record<string, unknown>;
  const id = row.runId ?? row.jobId;
  return typeof id === "string" ? id.trim() : "";
}

function getHistoryRecordEndedAtMs(record: unknown): number {
  if (!record || typeof record !== "object") return 0;
  const row = record as Record<string, unknown>;
  const endedAtMsRaw = Number(row.endedAtMs);
  if (Number.isFinite(endedAtMsRaw) && endedAtMsRaw > 0) return Math.floor(endedAtMsRaw);
  const endedAtRaw = row.endedAt;
  if (typeof endedAtRaw === "string" && endedAtRaw.trim()) {
    const parsed = Date.parse(endedAtRaw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function isValidHistoryRecord(record: unknown): boolean {
  return Boolean(getHistoryRecordId(record)) && getHistoryRecordEndedAtMs(record) > 0;
}

function toHistoryRunPayload(runPayload: Record<string, unknown> | null): OptimizerJobHistoryRecord["runPayload"] {
  const rawTapeIds = Array.isArray((runPayload as any)?.tapeIds) ? (runPayload as any).tapeIds : [];
  const tapeIds = rawTapeIds.map((id: unknown) => String(id ?? "")).filter(Boolean);
  return {
    tapeIds,
    ...(Number.isFinite(Number((runPayload as any)?.optTfMin)) ? { optTfMin: Math.floor(Number((runPayload as any)?.optTfMin)) } : {}),
    ...(Number.isFinite(Number((runPayload as any)?.timeRangeFromTs)) ? { timeRangeFromTs: Math.floor(Number((runPayload as any)?.timeRangeFromTs)) } : {}),
    ...(Number.isFinite(Number((runPayload as any)?.timeRangeToTs)) ? { timeRangeToTs: Math.floor(Number((runPayload as any)?.timeRangeToTs)) } : {}),
    candidates: Math.max(0, Math.floor(Number((runPayload as any)?.candidates) || 0)),
    seed: Number((runPayload as any)?.seed) || 1,
    minTrades: Math.max(0, Math.floor(Number((runPayload as any)?.minTrades) || 0)),
    directionMode: ["both", "long", "short"].includes(String((runPayload as any)?.directionMode)) ? String((runPayload as any)?.directionMode) as "both" | "long" | "short" : "both",
    rememberNegatives: Boolean((runPayload as any)?.rememberNegatives),
    excludeNegative: Boolean((runPayload as any)?.excludeNegative),
    ...(((runPayload as any)?.sim && typeof (runPayload as any).sim === "object") ? { sim: (runPayload as any).sim as OptimizerSimulationParams } : {}),
  };
}

function parseSimParams(raw: any): OptimizerSimulationParams {
  const base = configStore.get().paper;
  const marginPerTrade = raw?.marginPerTrade == null || String(raw.marginPerTrade).trim() === "" ? base.marginUSDT : Number(raw.marginPerTrade);
  if (!Number.isFinite(marginPerTrade) || marginPerTrade <= 0) {
    throw new Error("invalid_sim_margin_per_trade");
  }
  const leverage = raw?.leverage == null || String(raw.leverage).trim() === "" ? base.leverage : Number(raw.leverage);
  if (!Number.isFinite(leverage) || leverage < 1) {
    throw new Error("invalid_sim_leverage");
  }
  const feeBps = raw?.feeBps == null || String(raw.feeBps).trim() === "" ? 0 : Number(raw.feeBps);
  if (!Number.isFinite(feeBps) || feeBps < 0) {
    throw new Error("invalid_sim_fee_bps");
  }
  const fundingBpsPer8h = raw?.fundingBpsPer8h == null || String(raw.fundingBpsPer8h).trim() === "" ? 0 : Number(raw.fundingBpsPer8h);
  if (!Number.isFinite(fundingBpsPer8h)) {
    throw new Error("invalid_sim_funding_bps_per_8h");
  }
  const slippageBps = raw?.slippageBps == null || String(raw.slippageBps).trim() === "" ? 0 : Number(raw.slippageBps);
  if (!Number.isFinite(slippageBps) || slippageBps < 0) {
    throw new Error("invalid_sim_slippage_bps");
  }
  const initialBalance = raw?.initialBalance == null || String(raw.initialBalance).trim() === "" ? undefined : Number(raw.initialBalance);
  if (initialBalance != null && (!Number.isFinite(initialBalance) || initialBalance <= 0)) {
    throw new Error("invalid_sim_initial_balance");
  }
  return {
    ...(initialBalance != null ? { initialBalance } : {}),
    marginPerTrade,
    leverage,
    feeBps,
    fundingBpsPer8h,
    slippageBps,
  };
}

function appendOptimizerJobHistory(jobId: string, job: OptimizerJob) {
  if (!(job.status === "done" || job.status === "cancelled" || job.status === "error")) return;
  const sorted = sortOptimizationResults(Array.isArray(job.results) ? job.results : [], "netPnl", "desc");
  const best = sorted[0] ?? null;
  const rowsTotal = sorted.length;
  const rowsPositive = sorted.filter((row) => (row?.netPnl ?? 0) > 0).length;
  const endedAtMs = job.finishedAtMs ?? Date.now();
  const mode: "single" | "loop" = optimizerLoopState?.loopId && optimizerLoopState.lastJobId === jobId ? "loop" : "single";
  const historyStatus: OptimizerJobHistoryRecord["status"] = job.status === "cancelled" && !(optimizerLoopState?.isRunning) ? "stopped" : job.status;
  const nextRecord: OptimizerJobHistoryRecord = {
    jobId,
    mode,
    endedAtMs,
    status: historyStatus,
    runPayload: toHistoryRunPayload(job.runPayload),
    summary: {
      bestNetPnl: best ? best.netPnl : null,
      bestTrades: best ? best.trades : null,
      bestWinRate: best ? best.winRatePct : null,
      bestProfitFactor: best ? best.profitFactor : null,
      bestMaxDD: best ? best.maxDrawdownUsdt : null,
      rowsPositive,
      rowsTotal,
    },
  };
  const prev = readOptimizerJobHistory().filter((row) => row.jobId !== jobId);
  prev.unshift(nextRecord);
  writeOptimizerJobHistory(prev.slice(0, 500));
}


function ensureCheckpointDir() {
  fs.mkdirSync(checkpointDir, { recursive: true });
}

function checkpointPath(jobId: string) {
  ensureCheckpointDir();
  return path.join(checkpointDir, `job-${jobId}.json`);
}

function ensureOptimizerJobsDir() {
  fs.mkdirSync(optimizerJobsDir, { recursive: true });
}

function optimizerJobSnapshotPath(jobId: string) {
  ensureOptimizerJobsDir();
  return path.join(optimizerJobsDir, `job-${jobId}.json`);
}

function writeFileAtomic(filePath: string, body: string) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, body, "utf8");
  fs.renameSync(tempPath, filePath);
}

function pruneOldCheckpoints() {
  ensureCheckpointDir();
  const files = fs.readdirSync(checkpointDir)
    .filter((name) => /^job-.+\.json$/.test(name))
    .map((name) => ({ name, filePath: path.join(checkpointDir, name), mtimeMs: fs.statSync(path.join(checkpointDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files.slice(MAX_CHECKPOINT_FILES)) {
    try {
      fs.unlinkSync(file.filePath);
    } catch {
      continue;
    }
  }
}

function writeJobSnapshot(jobId: string, job: OptimizerJob, opts?: { force?: boolean }) {
  const now = Date.now();
  const lastWrite = lastSnapshotWriteMs.get(jobId) ?? 0;
  if (!opts?.force && now - lastWrite < MIN_CHECKPOINT_INTERVAL_MS) return;
  const disk = isLowDiskBestEffort(dataDir);
  if (disk.lowDisk) {
    job.message = [job.message, "snapshot skipped: low_disk"].filter(Boolean).join(" | ");
    return;
  }
  const snapshot: OptimizerJobSnapshot = {
    jobId,
    status: job.status,
    startedAtMs: job.startedAtMs,
    updatedAtMs: now,
    finishedAtMs: job.finishedAtMs,
    runPayload: job.runPayload,
    results: Array.isArray(job.results) ? job.results.slice(0, 2000) : [],
    ...(job.message ? { message: job.message } : {}),
  };
  writeFileAtomic(optimizerJobSnapshotPath(jobId), JSON.stringify(snapshot, null, 2));
  lastSnapshotWriteMs.set(jobId, now);
}

function writeCheckpoint(jobId: string, job: OptimizerJob, opts?: { force?: boolean }) {
  const checkpoint: OptimizerCheckpoint = {
    jobId,
    createdAt: job.startedAtMs,
    updatedAt: Date.now(),
    status: job.status,
    donePercent: job.done,
    processedCandidates: job.processedCandidates,
    totalCandidates: job.totalCandidates,
    topKResults: job.results.slice(0, 200),
    ...(job.message ? { message: job.message } : {}),
    minTrades: job.minTrades,
    startedAtMs: job.startedAtMs,
    excludeNegative: job.excludeNegative,
    rememberNegatives: job.rememberNegatives,
    runKey: job.runKey,
    finishedAtMs: job.finishedAtMs,
  };
  const now = Date.now();
  const lastWrite = lastCheckpointWriteMs.get(jobId) ?? 0;
  if (!opts?.force && now - lastWrite < MIN_CHECKPOINT_INTERVAL_MS) return;
  const disk = isLowDiskBestEffort(dataDir);
  if (disk.lowDisk) {
    job.message = [job.message, "checkpoint skipped: low_disk"].filter(Boolean).join(" | ");
    return;
  }
  writeFileAtomic(checkpointPath(jobId), JSON.stringify(checkpoint, null, 2));
  lastCheckpointWriteMs.set(jobId, now);
  pruneOldCheckpoints();
}

function restoreLatestCheckpoint() {
  ensureCheckpointDir();
  const files = fs.readdirSync(checkpointDir).filter((name) => /^job-.+\.json$/.test(name));
  if (!files.length) return;
  const latest = files
    .map((name) => ({ name, mtimeMs: fs.statSync(path.join(checkpointDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!latest) return;
  try {
    const raw = fs.readFileSync(path.join(checkpointDir, latest.name), "utf8");
    const parsed = JSON.parse(raw) as OptimizerCheckpoint;
    if (!parsed?.jobId) return;
    const job: OptimizerJob = {
      status: "paused",
      total: 100,
      done: Number(parsed.donePercent) || 0,
      lastPct: Number(parsed.donePercent) || 0,
      cancelRequested: false,
      pauseRequested: false,
      paused: true,
      resumeRequested: false,
      results: Array.isArray(parsed.topKResults) ? parsed.topKResults : [],
      minTrades: Number(parsed.minTrades) || 0,
      startedAtMs: Number(parsed.startedAtMs) || Date.now(),
      updatedAtMs: Number(parsed.updatedAt) || Date.now(),
      processedCandidates: Number(parsed.processedCandidates) || 0,
      totalCandidates: Number(parsed.totalCandidates) || 0,
      excludeNegative: Boolean(parsed.excludeNegative),
      rememberNegatives: Boolean((parsed as any).rememberNegatives),
      runKey: typeof (parsed as any).runKey === "string" ? (parsed as any).runKey : "",
      finishedAtMs: typeof (parsed as any).finishedAtMs === "number" ? (parsed as any).finishedAtMs : null,
      runPayload: null,
      ...(parsed.message ? { message: parsed.message } : {}),
    };
    optimizerJobs.set(parsed.jobId, job);
    rememberOptimizerJob(parsed.jobId);
  } catch {
    return;
  }
}

function restoreLatestJobSnapshot() {
  ensureOptimizerJobsDir();
  const files = fs.readdirSync(optimizerJobsDir).filter((name) => /^job-.+\.json$/.test(name));
  if (!files.length) return false;
  const latest = files
    .map((name) => ({ name, mtimeMs: fs.statSync(path.join(optimizerJobsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!latest) return false;
  try {
    const raw = fs.readFileSync(path.join(optimizerJobsDir, latest.name), "utf8");
    const parsed = JSON.parse(raw) as OptimizerJobSnapshot;
    if (!parsed?.jobId) return false;
    const wasRunning = parsed.status === "running";
    const now = Date.now();
    const job: OptimizerJob = {
      status: wasRunning ? "paused" : parsed.status,
      total: 100,
      done: 0,
      lastPct: 0,
      cancelRequested: false,
      pauseRequested: false,
      paused: wasRunning || parsed.status === "paused",
      resumeRequested: false,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      minTrades: Math.max(0, Math.floor(Number((parsed.runPayload as any)?.minTrades) || 0)),
      startedAtMs: Number(parsed.startedAtMs) || now,
      updatedAtMs: Number(parsed.updatedAtMs) || now,
      processedCandidates: 0,
      totalCandidates: Math.max(0, Math.floor(Number((parsed.runPayload as any)?.candidates) || 0)),
      excludeNegative: Boolean((parsed.runPayload as any)?.excludeNegative),
      rememberNegatives: Boolean((parsed.runPayload as any)?.rememberNegatives),
      runKey: `tapes=${Array.isArray((parsed.runPayload as any)?.tapeIds) ? [...(parsed.runPayload as any).tapeIds].sort().join(",") : ""}|dir=${String((parsed.runPayload as any)?.directionMode ?? "both")}|tf=${Number((parsed.runPayload as any)?.optTfMin ?? 0) || 0}`,
      finishedAtMs: typeof parsed.finishedAtMs === "number" ? parsed.finishedAtMs : null,
      runPayload: parsed.runPayload,
      ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
    };
    optimizerJobs.set(parsed.jobId, job);
    rememberOptimizerJob(parsed.jobId);
    return true;
  } catch {
    return false;
  }
}

function rememberOptimizerJob(jobId: string) {
  optimizerJobStartedAt.set(jobId, Date.now());
  latestOptimizerJobId = jobId;
}

function resolveCurrentOptimizerJobId(): string | null {
  const entries = Array.from(optimizerJobStartedAt.entries()).filter(([jobId]) => optimizerJobs.has(jobId));
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const running = entries.find(([jobId]) => {
    const st = optimizerJobs.get(jobId)?.status;
    return st === "running" || st === "paused";
  });
  if (running) return running[0];
  if (latestOptimizerJobId && optimizerJobs.has(latestOptimizerJobId)) return latestOptimizerJobId;
  return entries.at(0)?.[0] ?? null;
}

function isLocalRequestIp(ipRaw: unknown): boolean {
  const ip = String(ipRaw ?? "").trim();
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPauseOrTerminal(jobId: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = optimizerJobs.get(jobId);
    if (!job) return;
    if (job.status === "paused" || isOptimizerJobTerminal(job.status)) return;
    await sleep(100);
  }
}

export async function requestOptimizerGracefulPauseAndFlush(opts?: { timeoutMs?: number }) {
  const jobId = resolveCurrentOptimizerJobId();
  if (!jobId) return;
  const job = optimizerJobs.get(jobId);
  if (!job) return;
  if (job.status === "running") {
    job.pauseRequested = true;
    job.updatedAtMs = Date.now();
    optimizerWorkerManager.pause(jobId);
    await waitForPauseOrTerminal(jobId, opts?.timeoutMs ?? 3_000);
    if (job.status === "running") job.status = "paused";
  }
  writeCheckpoint(jobId, job, { force: true });
  writeJobSnapshot(jobId, job, { force: true });
}

export function setShutdownHandler(handler: (() => Promise<void> | void) | null) {
  shutdownHandler = handler;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("invalid_numeric_range");
  return n;
}

function parseRanges(raw: any): OptimizerRanges | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const parsed: OptimizerRanges = {};
  const assignIfDefined = (key: keyof OptimizerRanges, value: unknown) => {
    if (!value || typeof value !== "object") return;
    const min = toNumberOrUndefined((value as any).min);
    const max = toNumberOrUndefined((value as any).max);
    if (min === undefined && max === undefined) return;
    if (min === undefined || max === undefined) throw new Error(`invalid_range_${String(key)}`);
    if (min > max) throw new Error(`invalid_range_${String(key)}`);
    parsed[key] = { min, max };
  };

  assignIfDefined("priceTh", raw.priceTh);
  assignIfDefined("oivTh", raw.oivTh);
  assignIfDefined("tp", raw.tp);
  assignIfDefined("sl", raw.sl);
  assignIfDefined("offset", raw.offset);
  assignIfDefined("timeoutSec", raw.timeoutSec);
  assignIfDefined("rearmMs", raw.rearmMs);

  return parsed;
}

function parsePrecision(raw: any): Partial<OptimizerPrecision> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const keys: Array<keyof OptimizerPrecision> = ["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs"];
  const parsed: Partial<OptimizerPrecision> = {};
  for (const key of keys) {
    if ((raw as any)[key] === undefined) continue;
    const value = Number((raw as any)[key]);
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error(`invalid_precision_${String(key)}`);
    }
    parsed[key] = value;
  }
  return Object.keys(parsed).length ? parsed : undefined;
}

function parseOptimizerSort(query: any): { sortKey: OptimizerSortKey; sortDir: OptimizerSortDir } {
  const sortKey = ["netPnl", "trades", "winRatePct", "expectancy", "profitFactor", "maxDrawdownUsdt", "ordersPlaced", "ordersFilled", "ordersExpired", "priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs"].includes(String(query.sortKey))
    ? (String(query.sortKey) as OptimizerSortKey)
    : "netPnl";
  const sortDir = String(query.sortDir) === "asc" ? "asc" : "desc";
  return { sortKey, sortDir: sortDir as OptimizerSortDir };
}

function getOptimizerJobResultsSorted(job: OptimizerJob, query: any) {
  const { sortKey, sortDir } = parseOptimizerSort(query);
  const filtered = job.minTrades > 0 ? job.results.filter((r) => (r?.trades ?? 0) >= job.minTrades) : job.results;
  const sorted = sortOptimizationResults(filtered, sortKey, sortDir);
  return { sorted, sortKey, sortDir };
}

function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildOptimizerCsv(rows: Array<OptimizerResult & { rank: number }>): string {
  const headers = [
    "rank","netPnl","trades","winRatePct","expectancy","profitFactor","maxDrawdownUsdt","signalsOk","decisionsNoRefs",
    "ordersPlaced","ordersFilled","ordersExpired","closesTp","closesSl","closesForce",
    "priceThresholdPct","oivThresholdPct","entryOffsetPct","tpRoiPct","slRoiPct","timeoutSec","rearmMs"
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.rank,row.netPnl,row.trades,row.winRatePct,row.expectancy,row.profitFactor,row.maxDrawdownUsdt,row.signalsOk,row.decisionsNoRefs,
      row.ordersPlaced,row.ordersFilled,row.ordersExpired,row.closesTp,row.closesSl,row.closesForce,
      row.params.priceThresholdPct,row.params.oivThresholdPct,row.params.entryOffsetPct,row.params.tpRoiPct,row.params.slRoiPct,row.params.timeoutSec,row.params.rearmMs
    ].map(csvEscape).join(','));
  }
  return lines.join("\n");
}

function safeBody(reqBody: any) {
  if (reqBody == null) return {};
  if (typeof reqBody === "string") {
    try {
      return JSON.parse(reqBody);
    } catch {
      return {};
    }
  }
  return reqBody;
}

function arrayEq(a: any, b: any): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function universeWouldChange(cur: any, patch: any): boolean {
  if (!patch || typeof patch !== "object") return false;
  const u = (patch as any).universe;
  if (!u || typeof u !== "object") return false;

  const nextSelectedId = u.selectedId ?? cur.universe.selectedId;
  const nextSymbols = u.symbols ?? cur.universe.symbols;
  const nextTf = u.klineTfMin ?? cur.universe.klineTfMin;

  const idChanged = nextSelectedId !== cur.universe.selectedId;
  const symbolsChanged = !arrayEq(nextSymbols, cur.universe.symbols);
  const tfChanged = nextTf !== cur.universe.klineTfMin;

  return idChanged || symbolsChanged || tfChanged;
}

function getSessionDirFromEventsFile(eventsFile: string): string {
  return path.dirname(eventsFile);
}

function tryReadJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function getSummaryFilePath(eventsFile: string): string {
  return path.join(getSessionDirFromEventsFile(eventsFile), "summary.json");
}

function getDemoSummaryFilePath(eventsFile: string): string {
  return path.join(getSessionDirFromEventsFile(eventsFile), "demo_summary.json");
}

async function computeSummary(eventsFile: string, sessionId: string | null): Promise<SessionSummaryResponse> {
  const anyMod = paperSummary as any;

  const fn =
    anyMod.buildPaperSummaryFromJsonl ??
    anyMod.buildSummaryFromJsonl ??
    anyMod.buildPaperSummary ??
    anyMod.buildSummary;

  if (typeof fn !== "function") {
    throw new Error("summary_builder_not_found");
  }

  return (await fn(eventsFile, sessionId)) as SessionSummaryResponse;
}

if (!restoreLatestJobSnapshot()) restoreLatestCheckpoint();

function isOptimizerJobTerminal(status: OptimizerJob["status"]) {
  return status === "done" || status === "cancelled" || status === "error";
}

function updateLoopState(patch: Partial<OptimizerLoopState>) {
  if (!optimizerLoopState) return;
  const now = Date.now();
  const next: OptimizerLoopState = { ...optimizerLoopState, ...patch, updatedAtMs: now };
  if (patch.isRunning === false && optimizerLoopState.isRunning && optimizerLoopState.finishedAtMs == null) {
    next.finishedAtMs = now;
  }
  if (patch.isRunning === true) {
    next.finishedAtMs = null;
  }
  optimizerLoopState = next;
  writeLoopState(optimizerLoopState);
}

async function startLoopJob(app: FastifyInstance) {
  if (!optimizerLoopState || !optimizerLoopState.isRunning || optimizerLoopState.isPaused) return;
  const state = optimizerLoopState;
  if (!state.isInfinite && state.runIndex >= state.runsCount) {
    updateLoopState({ isRunning: false, isPaused: false });
    return;
  }
  const res = await app.inject({ method: "POST", url: "/api/optimizer/run", payload: withDatasetResolved(state.runPayload as Record<string, unknown>) });
  if (res.statusCode !== 200) {
    updateLoopState({ isRunning: false, isPaused: false });
    return;
  }
  const parsed = JSON.parse(res.body || "{}") as { jobId?: string };
  if (!parsed.jobId) {
    updateLoopState({ isRunning: false, isPaused: false });
    return;
  }
  updateLoopState({ lastJobId: parsed.jobId });
}

async function tickOptimizerLoop(app: FastifyInstance) {
  const state = optimizerLoopState;
  if (!state || !state.isRunning || state.isPaused) return;

  if (state.lastJobId) {
    const job = optimizerJobs.get(state.lastJobId);
    if (job && !isOptimizerJobTerminal(job.status)) return;
    updateLoopState({ runIndex: state.runIndex + 1, lastJobId: null });
  }

  const latest = optimizerLoopState;
  if (!latest || !latest.isRunning || latest.isPaused) return;
  if (!latest.isInfinite && latest.runIndex >= latest.runsCount) {
    updateLoopState({ isRunning: false, isPaused: false });
    return;
  }

  await startLoopJob(app);
}

function getLoopLastJobStatus() {
  if (!optimizerLoopState?.lastJobId) return null;
  const job = optimizerJobs.get(optimizerLoopState.lastJobId);
  if (!job) return null;
  return {
    status: job.status,
    donePercent: job.done,
    ...(job.message ? { message: job.message } : {}),
  };
}

function finalizeLoopForTerminalJob(jobId: string) {
  const state = optimizerLoopState;
  if (!state || !state.isRunning || state.lastJobId !== jobId) return;
  updateLoopState({ runIndex: state.runIndex + 1, lastJobId: null });
}

function normalizeOptionalTs(value: unknown): number | undefined {
  if (value == null || String(value).trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function resolveTapeFilesAtRunStart(baseTapeIds: string[], explicitTapeIds: string[]): Array<{ tapeId: string; bytes: number }> {
  const resolvedIds = [
    ...baseTapeIds.flatMap((baseTapeId) => listTapeSegments(baseTapeId)),
    ...explicitTapeIds,
  ];
  const dedupedIds = [...new Set(resolvedIds)];
  return dedupedIds
    .map((tapeId) => {
      try {
        return { tapeId, bytes: getTapeSizeBytes(tapeId) };
      } catch {
        return null;
      }
    })
    .filter((row): row is { tapeId: string; bytes: number } => row != null && row.bytes > 0);
}

function withDatasetResolved(runPayload: Record<string, unknown>): Record<string, unknown> {
  const snapshot = (runPayload as any)?.snapshot as SnapshotDescriptor | undefined;
  if (snapshot?.datasetMode === "snapshot") {
    return {
      ...runPayload,
      tapeIds: snapshot.tapeFiles.map((file) => file.tapeId),
      tapeFiles: snapshot.tapeFiles,
      ...(snapshot.timeRangeFromTs != null ? { timeRangeFromTs: snapshot.timeRangeFromTs } : {}),
      ...(snapshot.timeRangeToTs != null ? { timeRangeToTs: snapshot.timeRangeToTs } : {}),
    };
  }
  const followTail = (runPayload as any)?.followTail as FollowTailDescriptor | undefined;
  if (followTail?.datasetMode === "followTail") {
    const tapeFiles = resolveTapeFilesAtRunStart(followTail.baseTapeIds, followTail.explicitTapeIds);
    return {
      ...runPayload,
      tapeIds: tapeFiles.map((file) => file.tapeId),
      tapeFiles,
      ...(followTail.timeRangeFromTs != null ? { timeRangeFromTs: followTail.timeRangeFromTs } : {}),
      ...(followTail.timeRangeToTs != null ? { timeRangeToTs: followTail.timeRangeToTs } : {}),
    };
  }
  return runPayload;
}


function ensureWritableDir(dirPath: string): string | null {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return null;
  } catch (e: any) {
    return `${dirPath}: ${String(e?.message ?? e)}`;
  }
}


export function registerHttpRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/api/admin/shutdown", async (req, reply) => {
    if (!isLocalRequestIp((req as any).ip)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    reply.send({ ok: true });
    setImmediate(() => {
      void Promise.resolve(shutdownHandler?.());
    });
  });

  const loopTimer = setInterval(() => {
    void tickOptimizerLoop(app);
  }, 500);
  app.addHook("onClose", async () => {
    clearInterval(loopTimer);
  });

  let soakTimer: NodeJS.Timeout | null = null;
  const writeSoakSnapshot = () => {
    const status = runtime.getStatus();
    const mem = process.memoryUsage();
    const freeBytes = readFreeBytesBestEffort(dataDir);
    const currentJobId = resolveCurrentOptimizerJobId();
    const currentJob = currentJobId ? optimizerJobs.get(currentJobId) : null;
    const snapshot = {
      tsMs: Date.now(),
      sessionId: status.sessionId,
      state: status.sessionState,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      uptimeSec: Math.floor(process.uptime()),
      activeTapeId: tapeRecorder.getState().currentTapeId,
      dataDirFreeBytes: freeBytes,
      optimizerLoopStatus: optimizerLoopState?.isRunning ? (optimizerLoopState?.isPaused ? "paused" : "running") : "stopped",
      currentJobStatus: currentJob?.status ?? null,
    };
    fs.mkdirSync(path.dirname(SOAK_SNAPSHOT_PATH), { recursive: true });
    fs.appendFileSync(SOAK_SNAPSHOT_PATH, `${JSON.stringify(snapshot)}\n`, "utf8");
    lastSoakSnapshot = snapshot;
  };
  const syncSoakTimer = () => {
    const st = runtime.getStatus();
    if (st.sessionState === "RUNNING") {
      if (!soakTimer) {
        writeSoakSnapshot();
        soakTimer = setInterval(writeSoakSnapshot, 60_000);
      }
      return;
    }
    if (soakTimer) {
      clearInterval(soakTimer);
      soakTimer = null;
    }
  };
  runtime.on("state", syncSoakTimer);
  syncSoakTimer();
  app.addHook("onClose", async () => {
    runtime.off("state", syncSoakTimer);
    if (soakTimer) clearInterval(soakTimer);
  });

  app.get("/api/session/status", async () => runtime.getStatus());


  app.get("/api/doctor", async () => {
    const tapesDir = getOptimizerSettings().tapesDir;
    const warnings: string[] = [];
    const tapeWarning = ensureWritableDir(tapesDir);
    if (tapeWarning) warnings.push(`tapesDir not writable: ${tapeWarning}`);
    const checkpointWarning = ensureWritableDir(checkpointDir);
    if (checkpointWarning) warnings.push(`checkpointsDir not writable: ${checkpointWarning}`);
    const blacklistWarning = ensureWritableDir(optimizerBlacklistsDir);
    if (blacklistWarning) warnings.push(`blacklistsDir not writable: ${blacklistWarning}`);
    const freeBytes = readFreeBytesBestEffort(dataDir);
    if (freeBytes != null && freeBytes < MIN_FREE_BYTES) warnings.push("low_disk");
    const cfg = configStore.get();
    const isDemo = cfg.execution.mode === "demo";
    const demoKeysPresent = Boolean(process.env.BYBIT_DEMO_API_KEY) && Boolean(process.env.BYBIT_DEMO_API_SECRET);
    const demoBaseUrl = process.env.BYBIT_DEMO_REST_URL ?? "https://api-demo.bybit.com";
    let demoAuthOk = false;
    if (isDemo && demoKeysPresent) {
      try {
        const demoRest = new BybitDemoRestClient();
        await demoRest.getPositionsLinear({ settleCoin: "USDT" });
        demoAuthOk = true;
      } catch {
        demoAuthOk = false;
      }
    }
    return {
      ok: warnings.length === 0,
      nowMs: Date.now(),
      ports: { http: Number(process.env.PORT ?? 8080) },
      disk: { dataDir, freeBytes },
      dataDirBytesFree: freeBytes,
      paths: {
        tapesDir,
        checkpointsDir: checkpointDir,
        blacklistsDir: optimizerBlacklistsDir,
      },
      warnings,
      ...(isDemo ? { demoKeysPresent, demoBaseUrl, demoAuthOk } : {}),
    };
  });


  app.get("/api/soak/last", async () => {
    if (!lastSoakSnapshot) return { snapshot: null };
    return {
      snapshot: {
        tsMs: lastSoakSnapshot.tsMs,
        state: lastSoakSnapshot.state,
        memory: lastSoakSnapshot.memory,
        dataDirFreeBytes: lastSoakSnapshot.dataDirFreeBytes,
      },
    };
  });

  app.post("/api/session/start", async (_req, reply) => {
    const cfg = configStore.get();
    const id = String((cfg as any)?.universe?.selectedId ?? "");
    const symbols = Array.isArray((cfg as any)?.universe?.symbols) ? (cfg as any).universe.symbols : [];

    if (!id || symbols.length === 0) {
      reply.code(409);
      return { error: "universe_not_selected", message: "Select a Universe and click Apply before starting." };
    }

    return await runtime.start();
  });

  app.post("/api/session/stop", async () => runtime.stop());
  app.post("/api/session/pause", async () => runtime.pause());
  app.post("/api/session/resume", async () => runtime.resume());


  app.get("/api/dataset-target", async (req, reply) => {
    try {
      return { datasetTarget: readDatasetTarget() };
    } catch (e: any) {
      reply.code(500);
      return { error: "dataset_target_error", message: String(e?.message ?? "Failed to read dataset target.") };
    }
  });

  app.post("/api/dataset-target", async (req, reply) => {
    try {
      const normalized = normalizeDatasetTarget((req as any).body);
      writeDatasetTarget(normalized);
      return { datasetTarget: normalized };
    } catch (e: any) {
      reply.code(500);
      return { error: "dataset_target_error", message: String(e?.message ?? "Failed to persist dataset target.") };
    }
  });

  app.post("/api/data/receive", async (req, reply) => {
    const body = ((req as any).body && typeof (req as any).body === "object") ? ((req as any).body as Record<string, unknown>) : undefined;
    const started = startReceiveDataJob(body as any);
    if ("error" in started) {
      reply.code(400);
      return { error: started.error };
    }
    return { jobId: started.jobId };
  });

  app.get("/api/data/receive/:jobId", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const job = getReceiveDataJob(jobId);
    if (!job) {
      reply.code(404);
      return { error: "receive_job_not_found" };
    }
    return { job };
  });

  app.post("/api/data/receive/:jobId/cancel", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const ok = cancelReceiveDataJob(jobId);
    if (!ok) {
      reply.code(404);
      return { error: "receive_job_not_found" };
    }
    return { ok: true };
  });

  app.get("/api/config", async () => {
    return { config: configStore.get() };
  });

  app.post("/api/config", async (req, reply) => {
    const patch = safeBody((req as any).body);
    const cur = configStore.get();

    if (universeWouldChange(cur, patch) && runtime.isRunning()) {
      reply.code(409);
      return {
        error: "universe_change_requires_stopped_session",
        message: "Universe (symbols/klineTfMin) can be changed only when session is STOPPED."
      };
    }

    try {
      const config = configStore.update(patch);

      try {
        configStore.persist();
      } catch (e: any) {
        app.log.error({ err: e }, "failed to persist runtime config");
        reply.code(500);
        return { error: "config_persist_failed", message: String(e?.message ?? e) };
      }

      const uChanged = universeWouldChange(cur, patch);

      return {
        config,
        applied: {
          universe: uChanged ? "streams_reconnect" : "no_change",
          signals: true,
          fundingCooldown: true,
          paper: "next_session"
        }
      };
    } catch (err: any) {
      reply.code(400);
      return { error: "invalid_config", message: String(err?.message ?? err) };
    }
  });

  // universes
  app.get("/api/universes", async () => {
    return { universes: listUniverses() };
  });

  app.get("/api/universes/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      return readUniverse(id);
    } catch (e: any) {
      reply.code(404);
      return { error: "universe_not_found", message: String(e?.message ?? e) };
    }
  });

  app.post("/api/universes/create", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    const minTurnoverUsd = Number(body?.minTurnoverUsd);
    const minVolatilityPct = Number(body?.minVolatilityPct);

    if (!Number.isFinite(minTurnoverUsd) || minTurnoverUsd < 0) {
      reply.code(400);
      return { error: "invalid_minTurnoverUsd" };
    }
    if (!Number.isFinite(minVolatilityPct) || minVolatilityPct < 0) {
      reply.code(400);
      return { error: "invalid_minVolatilityPct" };
    }

    const { id, name } = formatUniverseName(minTurnoverUsd, minVolatilityPct);

    try {
      const symbols = await seedLinearUsdtPerpSymbols({ restBaseUrl: "https://api.bybit.com" });

      const res = await buildUniverseByTickersWs({
        wsUrl: CONFIG.bybit.wsUrl,
        symbols,
        minTurnoverUsd,
        minVolatilityPct,
        collectMs: 5000
      });
      const now = Date.now();
      let createdAt = now;
      try {
        createdAt = readUniverse(id).meta.createdAt ?? now;
      } catch {
        createdAt = now;
      }
      const file = writeUniverse({
        meta: {
          id,
          name,
          minTurnoverUsd,
          minVolatilityPct,
          createdAt,
          updatedAt: now,
          count: res.symbols.length
        },
        symbols: res.symbols
      });

      return { universe: file, stats: res };
    } catch (e: any) {
      reply.code(400);
      return { error: "universe_create_failed", message: String(e?.message ?? e) };
    }
  });

  app.delete("/api/universes/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    const status = runtime.getStatus();
    const selectedId = String((configStore.get() as any)?.universe?.selectedId ?? "");

    if ((status.sessionState === "RUNNING" || status.sessionState === "STOPPING") && selectedId === id) {
      reply.code(409);
      return {
        error: "universe_in_use",
        message: "Cannot delete universe while it is used by a running session."
      };
    }

    try {
      deleteUniverse(id);
      return { ok: true as const };
    } catch {
      reply.code(404);
      return { error: "universe_not_found" };
    }
  });

  // presets
  app.get("/api/presets", async () => {
    return { presets: listPresets().map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) };
  });

  app.get("/api/presets/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      return readPreset(id);
    } catch (e: any) {
      reply.code(404);
      return { error: "preset_not_found", message: String(e?.message ?? e) };
    }
  });

  app.put("/api/presets/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    const body = safeBody((req as any).body) as any;
    const name = String(body?.name ?? "").trim();
    const config = body?.config;

    if (!name || !config || typeof config !== "object") {
      reply.code(400);
      return { error: "invalid_preset_payload" };
    }

    try {
      const preset = putPreset(id, name, config);
      return preset;
    } catch (e: any) {
      reply.code(400);
      return { error: "preset_save_failed", message: String(e?.message ?? e) };
    }
  });

  app.delete("/api/presets/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      deletePreset(id);
      return { ok: true as const };
    } catch (e: any) {
      reply.code(404);
      return { error: "preset_not_found", message: String(e?.message ?? e) };
    }
  });

  app.get("/api/optimizer/tapes", async () => {
    const tapes = listTapes().map((tape) => {
      const baseTapeId = toBaseTapeId(tape.id);
      const bounds = readTapeBounds(baseTapeId);
      return {
        ...tape,
        startTs: bounds.startTs,
        endTs: bounds.endTs,
      };
    });
    return { tapes };
  });


  app.get("/api/optimizer/settings", async () => {
    return getOptimizerSettings();
  });

  app.post("/api/optimizer/settings", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    try {
      return setOptimizerSettings({ tapesDir: String(body?.tapesDir ?? "") });
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_settings", message: String(e?.message ?? e) };
    }
  });

  app.post("/api/optimizer/tapes/start", async (_req, reply) => {
    reply.code(409);
    return { error: "tape_recording_lifecycle_managed", message: "Tape recording is controlled by Session RUNNING state." };
  });

  app.post("/api/optimizer/tapes/stop", async (_req, reply) => {
    reply.code(409);
    return { error: "tape_recording_lifecycle_managed", message: "Tape recording is controlled by Session RUNNING state." };
  });

  app.get("/api/optimizer/status", async () => {
    const state = tapeRecorder.getState();
    return { isRecording: state.isRecording, tapeId: state.currentTapeId };
  });

  app.post("/api/optimizer/run", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    const tapeIdsRaw = Array.isArray(body?.tapeIds) ? body.tapeIds : undefined;
    const tapeIds = (tapeIdsRaw ?? [body?.tapeId]).map((v: unknown) => String(v ?? "").trim()).filter(Boolean);
    const datasetMode: DatasetMode = body?.datasetMode === "followTail" ? "followTail" : "snapshot";
    const timeRangeFromTs = normalizeOptionalTs(body?.timeRangeFromTs);
    const timeRangeToTs = normalizeOptionalTs(body?.timeRangeToTs);
    if (timeRangeFromTs != null && timeRangeToTs != null && timeRangeFromTs > timeRangeToTs) {
      reply.code(400);
      return { error: "invalid_time_range" };
    }
    const candidates = Number(body?.candidates);
    const seed = Number(body?.seed ?? 1);
    const directionMode = body?.directionMode == null ? "both" : String(body.directionMode);
    const optTfMinRaw = body?.optTfMin;
    const optTfMin = optTfMinRaw == null || String(optTfMinRaw).trim() === "" ? undefined : Math.floor(Number(optTfMinRaw));
    const minTradesRaw = body?.minTrades;
    const minTrades = minTradesRaw == null || String(minTradesRaw).trim() === "" ? 1 : Math.floor(Number(minTradesRaw));
    const excludeNegative = Boolean(body?.excludeNegative);
    const rememberNegatives = Boolean(body?.rememberNegatives);
    let sim: OptimizerSimulationParams;
    try {
      sim = parseSimParams(body?.sim);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }
    const runKey = `tapes=${[...tapeIds].sort().join(",")}|dir=${directionMode}|tf=${optTfMin ?? 0}`;

    if (!Number.isFinite(candidates) || candidates < 1 || candidates > 2000) {
      reply.code(400);
      return { error: "invalid_candidates" };
    }
    if (!tapeIds.length) {
      reply.code(400);
      return { error: "invalid_tape_id", message: "No tape IDs provided" };
    }
    if (!["both", "long", "short"].includes(directionMode)) {
      reply.code(400);
      return { error: "invalid_direction_mode" };
    }
    if (optTfMin !== undefined && (!Number.isFinite(optTfMin) || optTfMin < 1 || optTfMin > 240)) {
      reply.code(400);
      return { error: "invalid_opt_tf_min" };
    }
    if (!Number.isFinite(minTrades) || minTrades < 0 || minTrades > 1_000_000) {
      reply.code(400);
      return { error: "invalid_min_trades" };
    }
    try {
      tapeIds.forEach((id: string) => safeId(id));
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_tape_id", message: String(e?.message ?? e) };
    }

    const explicitTapeIds = tapeIds.filter((id: string) => id.includes("-seg"));
    const baseTapeIds = tapeIds.filter((id: string) => !id.includes("-seg"));
    const snapshotTapeFiles = datasetMode === "snapshot" ? resolveTapeFilesAtRunStart(baseTapeIds, explicitTapeIds) : [];
    if (datasetMode === "snapshot" && !snapshotTapeFiles.length) {
      reply.code(400);
      return { error: "invalid_tape_id", message: "No readable tape files found" };
    }

    let ranges: OptimizerRanges | undefined;
    let precision: Partial<OptimizerPrecision> | undefined;
    try {
      ranges = parseRanges(body?.ranges);
      precision = parsePrecision(body?.precision);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }

    incrementTapeRuns(tapeIds);

    const jobId = randomUUID();
    const totalCandidates = Math.floor(candidates);
    const job: OptimizerJob = {
      status: "running",
      total: 100,
      done: 0,
      lastPct: 0,
      cancelRequested: false,
      pauseRequested: false,
      paused: false,
      resumeRequested: false,
      results: [],
      minTrades,
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      processedCandidates: 0,
      totalCandidates,
      excludeNegative,
      rememberNegatives,
      runKey,
      finishedAtMs: null,
      runPayload: null,
    };
    optimizerJobs.set(jobId, job);
    rememberOptimizerJob(jobId);
    writeCheckpoint(jobId, job);
    writeJobSnapshot(jobId, job);

    const runPayload = {
      tapeIds: datasetMode === "snapshot" ? snapshotTapeFiles.map((file) => file.tapeId) : tapeIds,
      ...(datasetMode === "snapshot"
        ? {
            snapshot: {
              datasetMode: "snapshot",
              tapeFiles: snapshotTapeFiles,
              ...(timeRangeFromTs != null ? { timeRangeFromTs } : {}),
              ...(timeRangeToTs != null ? { timeRangeToTs } : {}),
            } as SnapshotDescriptor,
            tapeFiles: snapshotTapeFiles,
          }
        : {
            followTail: {
              datasetMode: "followTail",
              baseTapeIds,
              explicitTapeIds,
              ...(timeRangeFromTs != null ? { timeRangeFromTs } : {}),
              ...(timeRangeToTs != null ? { timeRangeToTs } : {}),
            } as FollowTailDescriptor,
          }),
      candidates: totalCandidates,
      seed: Number.isFinite(seed) ? seed : 1,
      ...(ranges ? { ranges } : {}),
      ...(precision ? { precision } : { precision: DEFAULT_OPTIMIZER_PRECISION }),
      directionMode: directionMode as "both" | "long" | "short",
      ...(optTfMin !== undefined ? { optTfMin } : {}),
      minTrades,
      excludeNegative,
      rememberNegatives,
      ...(timeRangeFromTs != null ? { timeRangeFromTs } : {}),
      ...(timeRangeToTs != null ? { timeRangeToTs } : {}),
      sim,
    };
    job.runPayload = runPayload;
    const resolvedRunPayload = withDatasetResolved(runPayload as Record<string, unknown>);

    try {
      optimizerWorkerManager.start(jobId, resolvedRunPayload, {
        onProgress: (msg) => {
          const pct2 = Math.max(0, Math.min(100, Math.round((Number(msg.donePercent) || 0) * 100) / 100));
          job.lastPct = pct2;
          job.done = pct2;
          job.total = 100;
          job.processedCandidates = Number(msg.done) || 0;
          job.totalCandidates = Number(msg.total) || totalCandidates;
          job.updatedAtMs = Date.now();
          const preview = Array.isArray(msg.previewResults) ? msg.previewResults : [];
          job.results = preview.filter((r: any) => !job.excludeNegative || (r?.netPnl ?? 0) >= 0).slice(0, 200);
          if (typeof msg.messageAppend === "string" && msg.messageAppend) {
            job.message = [job.message, msg.messageAppend].filter(Boolean).join(" | ");
          }
          if (job.pauseRequested && job.status === "running") {
            job.pauseRequested = false;
            job.paused = true;
            job.status = "paused";
            optimizerWorkerManager.pause(jobId);
          }
          if (job.resumeRequested && job.status === "paused") {
            job.resumeRequested = false;
            job.paused = false;
            job.status = "running";
            optimizerWorkerManager.resume(jobId);
          }
          if (job.cancelRequested) optimizerWorkerManager.cancel(jobId);
          writeCheckpoint(jobId, job);
          writeJobSnapshot(jobId, job);
        },
        onCheckpoint: () => {
          writeCheckpoint(jobId, job);
          writeJobSnapshot(jobId, job);
        },
        onDone: (msg) => {
          const finalResults = Array.isArray(msg.finalResults) ? msg.finalResults : [];
          job.results = finalResults.filter((r: any) => !job.excludeNegative || (r?.netPnl ?? 0) >= 0).slice(0, 2000);
          job.updatedAtMs = Date.now();
          if (job.cancelRequested) {
            job.status = "cancelled";
            job.message = "Optimization cancelled.";
          } else {
            job.lastPct = 100;
            job.done = 100;
            job.total = 100;
            job.status = "done";
            const totalStored = Array.isArray(job.results) ? job.results.length : 0;
            const tradedCandidates = totalStored > 0 ? job.results.filter((r) => (r?.trades ?? 0) > 0).length : 0;
            job.message = `Min trades filter: ${minTrades} | Candidates with trades>0: ${tradedCandidates}/${totalStored}`;
          }
          if (job.finishedAtMs == null) job.finishedAtMs = Date.now();
          appendOptimizerJobHistory(jobId, job);
          writeCheckpoint(jobId, job, { force: true });
          writeJobSnapshot(jobId, job, { force: true });
          finalizeLoopForTerminalJob(jobId);
          void tickOptimizerLoop(app);
        },
        onError: (msg) => {
          job.status = "error";
          job.updatedAtMs = Date.now();
          if (job.finishedAtMs == null) job.finishedAtMs = Date.now();
          job.message = String(msg?.errorMessage ?? "worker_error");
          appendOptimizerJobHistory(jobId, job);
          writeCheckpoint(jobId, job, { force: true });
          writeJobSnapshot(jobId, job, { force: true });
          finalizeLoopForTerminalJob(jobId);
          void tickOptimizerLoop(app);
        },
      });
    } catch (e: any) {
      job.status = "error";
      job.message = String(e?.message ?? e);
      if (job.finishedAtMs == null) job.finishedAtMs = Date.now();
      appendOptimizerJobHistory(jobId, job);
      writeCheckpoint(jobId, job, { force: true });
      writeJobSnapshot(jobId, job, { force: true });
      finalizeLoopForTerminalJob(jobId);
    }

    return { jobId };
  });

  app.post("/api/optimizer/loop/start", async (req, reply) => {
    if (optimizerLoopState?.isRunning) {
      reply.code(409);
      return { error: "optimizer_loop_running" };
    }

    const body = safeBody((req as any).body) as any;
    const normalizedTapeIds = (Array.isArray(body?.tapeIds) ? body.tapeIds : [body?.tapeId]).map((v: unknown) => String(v ?? "").trim()).filter(Boolean);
    const datasetMode: DatasetMode = body?.datasetMode === "followTail" ? "followTail" : "snapshot";
    const timeRangeFromTs = normalizeOptionalTs(body?.timeRangeFromTs);
    const timeRangeToTs = normalizeOptionalTs(body?.timeRangeToTs);
    if (timeRangeFromTs != null && timeRangeToTs != null && timeRangeFromTs > timeRangeToTs) {
      reply.code(400);
      return { error: "invalid_time_range" };
    }
    const explicitTapeIds = normalizedTapeIds.filter((id: string) => id.includes("-seg"));
    const baseTapeIds = normalizedTapeIds.filter((id: string) => !id.includes("-seg"));
    const snapshotTapeFiles = datasetMode === "snapshot" ? resolveTapeFilesAtRunStart(baseTapeIds, explicitTapeIds) : [];
    if (datasetMode === "snapshot" && !snapshotTapeFiles.length) {
      reply.code(400);
      return { error: "invalid_tape_id", message: "No readable tape files found" };
    }
    let sim: OptimizerSimulationParams;
    try {
      sim = parseSimParams(body?.sim);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }
    const payload: OptimizerLoopRunPayload = {
      ...body,
      tapeIds: normalizedTapeIds,
      ...(datasetMode === "snapshot"
        ? {
            snapshot: {
              datasetMode: "snapshot",
              tapeFiles: snapshotTapeFiles,
              ...(timeRangeFromTs != null ? { timeRangeFromTs } : {}),
              ...(timeRangeToTs != null ? { timeRangeToTs } : {}),
            } as SnapshotDescriptor,
          }
        : {
            followTail: {
              datasetMode: "followTail",
              baseTapeIds,
              explicitTapeIds,
              ...(timeRangeFromTs != null ? { timeRangeFromTs } : {}),
              ...(timeRangeToTs != null ? { timeRangeToTs } : {}),
            } as FollowTailDescriptor,
          }),
      datasetMode,
      candidates: Number(body?.candidates),
      seed: Number(body?.seed ?? 1),
      directionMode: body?.directionMode == null ? "both" : String(body.directionMode) as "both" | "long" | "short",
      minTrades: body?.minTrades == null || String(body.minTrades).trim() === "" ? 1 : Math.floor(Number(body.minTrades)),
      excludeNegative: Boolean(body?.excludeNegative),
      rememberNegatives: Boolean(body?.rememberNegatives),
      ...(timeRangeFromTs != null ? { timeRangeFromTs } : {}),
      ...(timeRangeToTs != null ? { timeRangeToTs } : {}),
      ...(body?.optTfMin == null || String(body.optTfMin).trim() === "" ? {} : { optTfMin: Math.floor(Number(body.optTfMin)) }),
      ...(body?.ranges ? { ranges: body.ranges } : {}),
      ...(body?.precision ? { precision: body.precision } : {}),
      sim,
    };
    const runsCount = Math.max(1, Math.floor(Number(body?.runsCount ?? 1)));
    const isInfinite = Boolean(body?.infinite);

    const now = Date.now();
    optimizerLoopState = {
      loopId: randomUUID(),
      isRunning: true,
      isPaused: false,
      isInfinite,
      runsCount,
      runIndex: 0,
      createdAtMs: now,
      updatedAtMs: now,
      finishedAtMs: null,
      lastJobId: null,
      runPayload: payload,
    };
    writeLoopState(optimizerLoopState);
    await startLoopJob(app);
    if (!optimizerLoopState.lastJobId) {
      const failedLoopId = optimizerLoopState.loopId;
      updateLoopState({ isRunning: false, isPaused: false });
      reply.code(400);
      return { error: "optimizer_loop_start_failed", loopId: failedLoopId };
    }
    return { loopId: optimizerLoopState.loopId };
  });

  app.post("/api/optimizer/loop/stop", async () => {
    const state = optimizerLoopState;
    if (!state) return { ok: true };
    if (state.lastJobId) {
      const job = optimizerJobs.get(state.lastJobId);
      if (job && (job.status === "running" || job.status === "paused")) {
        job.cancelRequested = true;
        job.updatedAtMs = Date.now();
        optimizerWorkerManager.cancel(state.lastJobId);
        writeCheckpoint(state.lastJobId, job);
        writeJobSnapshot(state.lastJobId, job);
      }
    }
    updateLoopState({ isRunning: false, isPaused: false });
    return { ok: true };
  });

  app.post("/api/optimizer/loop/pause", async () => {
    if (!optimizerLoopState) return { ok: true };
    updateLoopState({ isPaused: true });
    const state = optimizerLoopState;
    if (state?.lastJobId) {
      const job = optimizerJobs.get(state.lastJobId);
      if (job && job.status === "running") {
        job.pauseRequested = true;
        job.updatedAtMs = Date.now();
        optimizerWorkerManager.pause(state.lastJobId);
        job.status = "paused";
      }
    }
    return { ok: true };
  });

  app.post("/api/optimizer/loop/resume", async (_req, reply) => {
    const state = optimizerLoopState;
    if (!state) {
      reply.code(404);
      return { error: "optimizer_loop_not_found" };
    }
    updateLoopState({ isPaused: false, isRunning: true });
    if (state.lastJobId) {
      const job = optimizerJobs.get(state.lastJobId);
      if (job && job.status === "paused") {
        job.resumeRequested = true;
        job.updatedAtMs = Date.now();
        optimizerWorkerManager.resume(state.lastJobId);
        job.status = "running";
      }
    }
    await tickOptimizerLoop(app);
    return { ok: true };
  });

  app.get("/api/optimizer/loop/status", async () => {
    if (!optimizerLoopState) return { loop: null };
    return {
      loop: optimizerLoopState,
      runsCompleted: optimizerLoopState.runIndex,
      runsTotal: optimizerLoopState.isInfinite ? null : optimizerLoopState.runsCount,
      lastJobStatus: getLoopLastJobStatus(),
    };
  });

  app.post("/api/optimizer/jobs/current/cancel", async (_req, reply) => {
    const jobId = resolveCurrentOptimizerJobId();
    if (!jobId) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }
    const job = optimizerJobs.get(jobId);
    if (!job || (job.status !== "running" && job.status !== "paused")) {
      reply.code(409);
      return { error: "optimizer_job_not_running" };
    }
    job.cancelRequested = true;
    job.updatedAtMs = Date.now();
    optimizerWorkerManager.cancel(jobId);
    writeCheckpoint(jobId, job);
    writeJobSnapshot(jobId, job);
    return { ok: true };
  });

  app.post("/api/optimizer/jobs/current/pause", async (_req, reply) => {
    const jobId = resolveCurrentOptimizerJobId();
    if (!jobId) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }
    const job = optimizerJobs.get(jobId);
    if (!job || job.status !== "running") {
      reply.code(409);
      return { error: "optimizer_job_not_running" };
    }
    job.pauseRequested = true;
    job.updatedAtMs = Date.now();
    optimizerWorkerManager.pause(jobId);
    job.status = "paused";
    writeCheckpoint(jobId, job);
    writeJobSnapshot(jobId, job);
    return { ok: true };
  });

  app.post("/api/optimizer/jobs/current/resume", async (_req, reply) => {
    const jobId = resolveCurrentOptimizerJobId();
    if (!jobId) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }
    const job = optimizerJobs.get(jobId);
    if (!job || job.status !== "paused") {
      reply.code(409);
      return { error: "optimizer_job_not_paused" };
    }
    job.resumeRequested = true;
    job.updatedAtMs = Date.now();
    optimizerWorkerManager.resume(jobId);
    job.status = "running";
    writeCheckpoint(jobId, job);
    writeJobSnapshot(jobId, job);
    return { ok: true };
  });

  app.get("/api/optimizer/jobs/current", async () => {
    const jobId = resolveCurrentOptimizerJobId();
    return { jobId };
  });

  app.get("/api/optimizer/jobs/:jobId/status", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const job = optimizerJobs.get(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }

    return {
      status: job.status,
      total: job.total,
      done: job.done,
      donePct: job.done,
      startedAtMs: job.startedAtMs,
      updatedAtMs: job.updatedAtMs,
      finishedAtMs: job.finishedAtMs,
      ...(job.message ? { message: job.message } : {}),
    };
  });

  app.get("/api/optimizer/jobs/:jobId/results", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const query = (req.query ?? {}) as any;
    const job = optimizerJobs.get(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }

    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = 50;
    const { sorted: unsafelySorted, sortKey, sortDir } = getOptimizerJobResultsSorted(job, query);
    const positiveOnly = String(query.positiveOnly ?? "") === "1";
    const sorted = positiveOnly ? unsafelySorted.filter((row) => (row?.netPnl ?? 0) > 0) : unsafelySorted;
    const start = (page - 1) * pageSize;
    const pageRows = sorted.slice(start, start + pageSize).map((result, index) => ({
      rank: start + index + 1,
      ...result,
    }));

    return {
      status: job.status,
      page,
      pageSize,
      totalRows: sorted.length,
      sortKey,
      sortDir,
      results: pageRows,
    };
  });

  app.get("/api/optimizer/jobs/history", async (req) => {
    const query = (req.query ?? {}) as any;
    const requestedLimit = Math.floor(Number(query.limit) || 25);
    const limit = [10, 25, 50, 100].includes(requestedLimit) ? requestedLimit : 25;
    const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
    const sortKey = String(query.sortKey ?? "endedAtMs");
    const sortDir: "asc" | "desc" = String(query.sortDir ?? "desc") === "asc" ? "asc" : "desc";
    const history = readOptimizerJobHistory();
    const sorted = history.sort((a, b) => {
      const getValue = (row: OptimizerJobHistoryRecord): number | string => {
        switch (sortKey) {
          case "jobId": return row.jobId;
          case "endedAtMs": return Number(row.endedAtMs) || 0;
          case "status": return row.status;
          case "mode": return row.mode ?? "";
          case "tapes": return row.runPayload.tapeIds.length;
          case "tfMin": return Number(row.runPayload.optTfMin) || 0;
          case "candidates": return Number(row.runPayload.candidates) || 0;
          case "seed": return Number(row.runPayload.seed) || 0;
          case "minTrades": return Number(row.runPayload.minTrades) || 0;
          case "direction": return row.runPayload.directionMode;
          case "rememberNegatives": return row.runPayload.rememberNegatives ? 1 : 0;
          case "hideNegativeNetPnl": return row.runPayload.excludeNegative ? 1 : 0;
          case "bestNetPnl": return Number(row.summary.bestNetPnl) || 0;
          case "bestTrades": return Number(row.summary.bestTrades) || 0;
          case "bestWinRate": return Number(row.summary.bestWinRate) || 0;
          case "bestProfitFactor": return Number(row.summary.bestProfitFactor) || 0;
          case "bestMaxDD": return Number(row.summary.bestMaxDD) || 0;
          case "rowsPositive": return Number(row.summary.rowsPositive) || 0;
          case "rowsTotal": return Number(row.summary.rowsTotal) || 0;
          default: return Number(row.endedAtMs) || 0;
        }
      };
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        if (av === bv) return 0;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    const items = sorted.slice(offset, offset + limit);
    return { total: sorted.length, items };
  });

  app.get("/api/optimizer/history/export", async (req, reply) => {
    if (!isLocalRequestIp((req as any).ip)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    reply.header("Content-Type", "application/json; charset=utf-8");
    const runs = readOptimizerJobHistoryRaw();
    const loopState = readLoopState();
    return {
      exportedAtMs: Date.now(),
      runs,
      ...(loopState ? { loopState } : {}),
    };
  });

  app.post("/api/optimizer/history/import", async (req, reply) => {
    if (!isLocalRequestIp((req as any).ip)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const body = safeBody((req as any).body) as any;
    const incoming = Array.isArray(body?.runs) ? body.runs : null;
    if (!incoming) {
      reply.code(400);
      return { error: "invalid_history_payload" };
    }
    if (!incoming.every(isValidHistoryRecord)) {
      reply.code(400);
      return { error: "invalid_history_run" };
    }
    const mode = String(body?.mode ?? "merge") === "replace" ? "replace" : "merge";
    if (mode === "replace") {
      writeOptimizerJobHistoryRaw(incoming);
      return { ok: true, imported: incoming.length, total: incoming.length, mode };
    }

    const merged = [...readOptimizerJobHistoryRaw(), ...incoming];
    const byId = new Map<string, unknown>();
    for (const row of merged) {
      const id = getHistoryRecordId(row);
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing || getHistoryRecordEndedAtMs(row) >= getHistoryRecordEndedAtMs(existing)) {
        byId.set(id, row);
      }
    }
    const deduped = Array.from(byId.values()).sort((a, b) => getHistoryRecordEndedAtMs(b) - getHistoryRecordEndedAtMs(a));
    writeOptimizerJobHistoryRaw(deduped);
    return { ok: true, imported: incoming.length, total: deduped.length, mode };
  });


  app.get("/api/optimizer/jobs/:jobId/export", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const query = (req.query ?? {}) as any;
    const format = String(query.format ?? "json").toLowerCase() === "csv" ? "csv" : "json";
    const job = optimizerJobs.get(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }

    const { sorted } = getOptimizerJobResultsSorted(job, query);
    const ranked = sorted.map((result, index) => ({ rank: index + 1, ...result }));
    if (format === "csv") {
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="optimizer-job-${jobId}.csv"`);
      return reply.send(buildOptimizerCsv(ranked));
    }

    return {
      jobId,
      status: job.status,
      startedAtMs: job.startedAtMs,
      finishedAtMs: job.finishedAtMs,
      runPayload: job.runPayload,
      results: ranked,
    };
  });

  app.get("/api/optimizer/jobs/current/export", async (req, reply) => {
    const jobId = resolveCurrentOptimizerJobId();
    if (!jobId) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }
    const query = (req.query ?? {}) as any;
    const format = String(query.format ?? "json").toLowerCase() === "csv" ? "csv" : "json";
    const job = optimizerJobs.get(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }
    const { sorted } = getOptimizerJobResultsSorted(job, query);
    const ranked = sorted.map((result, index) => ({ rank: index + 1, ...result }));
    if (format === "csv") {
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="optimizer-job-${jobId}.csv"`);
      return reply.send(buildOptimizerCsv(ranked));
    }
    return {
      jobId,
      status: job.status,
      startedAtMs: job.startedAtMs,
      finishedAtMs: job.finishedAtMs,
      runPayload: job.runPayload,
      results: ranked,
    };
  });

  app.get("/api/stats/trade-by-symbol", async (req, reply) => {
    const query = (req.query ?? {}) as any;
    const mode = String(query.mode ?? "both");
    if (!["both", "long", "short"].includes(mode)) {
      reply.code(400);
      return { error: "invalid_mode" };
    }
    const symbols = configStore.get().universe.symbols ?? [];
    return {
      sessionId: runtime.getStatus().sessionId,
      mode,
      stats: runtime.getTradeStatsBySymbol(mode as "both" | "long" | "short", symbols),
    };
  });

  app.get("/api/stats/trade-excursions-by-symbol", async () => {
    const symbols = configStore.get().universe.symbols ?? [];
    return {
      sessionId: runtime.getStatus().sessionId,
      stats: runtime.getTradeExcursionsBySymbol(symbols),
    };
  });

  // paper summary
  app.get("/api/session/summary", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }

    const summaryPath = getSummaryFilePath(st.eventsFile);

    const fromFile = tryReadJsonFile<SessionSummaryResponse>(summaryPath);
    if (fromFile) return fromFile;

    try {
      const computed = await computeSummary(st.eventsFile, st.sessionId ?? null);
      return computed;
    } catch (e: any) {
      reply.code(404);
      return { error: "no_summary", message: String(e?.message ?? e) };
    }
  });

  app.get("/api/session/summary/download", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }

    const summaryPath = getSummaryFilePath(st.eventsFile);
    if (!fs.existsSync(summaryPath)) {
      try {
        const computed = await computeSummary(st.eventsFile, st.sessionId ?? null);
        fs.writeFileSync(summaryPath, JSON.stringify(computed, null, 2), "utf8");
      } catch (e: any) {
        reply.code(404);
        return { error: "no_summary", message: String(e?.message ?? e) };
      }
    }

    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="summary.json"');

    const stream = fs.createReadStream(summaryPath);
    return reply.send(stream);
  });

  app.get("/api/session/demo-summary", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }
    const demoSummaryPath = getDemoSummaryFilePath(st.eventsFile);
    const fromFile = tryReadJsonFile<any>(demoSummaryPath);
    if (!fromFile) {
      reply.code(404);
      return { error: "no_demo_summary" };
    }
    return fromFile;
  });

  app.get("/api/session/demo-summary/download", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }
    const demoSummaryPath = getDemoSummaryFilePath(st.eventsFile);
    if (!fs.existsSync(demoSummaryPath)) {
      reply.code(404);
      return { error: "no_demo_summary" };
    }
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="demo_summary.json"');
    const stream = fs.createReadStream(demoSummaryPath);
    return reply.send(stream);
  });

  // download current session jsonl
  app.get("/api/session/events/download", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }

    const filename = path.basename(st.eventsFile);
    reply.header("Content-Type", "application/jsonl; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(st.eventsFile);
    return reply.send(stream);
  });

  app.get("/api/session/run-pack", async (_req, reply) => {
    const st = runtime.getStatus();
    const sessionId = st.sessionId;
    const demoSummaryUrl = st.eventsFile && fs.existsSync(getDemoSummaryFilePath(st.eventsFile))
      ? "/api/session/demo-summary/download"
      : null;
    const manifest = {
      sessionId,
      eventsUrl: "/api/session/events/download",
      summaryUrl: "/api/session/summary/download",
      demoSummaryUrl,
      configSnapshotUrl: "/api/session/run-pack/config/download",
      universeSnapshotUrl: "/api/session/run-pack/universe/download",
    };
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="run-pack.json"');
    return manifest;
  });

  app.get("/api/session/run-pack/config/download", async (_req, reply) => {
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="run-pack-config.json"');
    return configStore.get();
  });

  app.get("/api/session/run-pack/universe/download", async (_req, reply) => {
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="run-pack-universe.json"');
    return configStore.get().universe;
  });
}
