import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runtime } from "../runtime/runtime.js";
import { CONFIG } from "../config.js";
import { configStore } from "../runtime/configStore.js";
import { DEFAULT_BOT_ID, getBotDefinition, listBots } from "../bots/registry.js";
import { deleteUniverse, listUniverses, readUniverse, writeUniverse, formatUniverseName } from "../universe/universeStore.js";
import { buildUniverseByAverageMetrics, normalizeUniverseMetricsRange } from "../universe/universeAverageBuilder.js";
import { buildUniverseSymbolRangeSummary } from "../universe/universeSymbolSummary.js";
import { seedLinearUsdtPerpSymbols } from "../universe/universeSeed.js";
import * as paperSummary from "../paper/summary.js";
type SessionSummaryResponse = any;
import { deletePreset, listPresets, putPreset, readPreset } from "../presets/presetStore.js";
import { DEFAULT_BOT_PRESET_ID, deleteBotPreset, ensureDefaultBotPreset, listBotPresets, putBotPreset, readBotPreset } from "../presets/botPresetStore.js";
import { deleteExecutionProfile, listExecutionProfiles, putExecutionProfile, readExecutionProfile } from "../presets/executionProfileStore.js";
import { readLoopState, recoverLoopStateOnBoot, type OptimizerLoopProgressState, type OptimizerLoopRunPayload, type OptimizerLoopState, writeLoopState } from "../optimizer/loopStore.js";
import {
  DEFAULT_OPTIMIZER_PRECISION,
  simulateCandidateTrades,
  type OptimizerParams,
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
import { cancelReceiveDataJob, getActiveReceiveDataJob, getReceiveDataJob, startReceiveDataJob } from "../dataset/receiveDataStore.js";
import { deleteDatasetHistory, incrementDatasetHistoryLoops, listDatasetHistories, readDatasetHistory } from "../dataset/datasetHistoryStore.js";
import { awaitAllStreamsConnected, broadcastOptimizerRowsAppend, requestStreamLifecycleSync, setOptimizerSnapshotProvider } from "./wsHub.js";
import { cvdRecorder, minuteOiRecorder } from "../recorder/recorderStore.js";
import { readRecorderUniverseState, setRecorderUniverseById, setRecorderUniverseSymbols } from "../recorder/recorderUniverseStore.js";
import { collectProviderCapabilities } from "./providerCapabilities.js";

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
  loopId?: string;
  historyType?: "run" | "session";
  sessionRunsTotal?: number;
  sessionRunsCompleted?: number;
  childJobIds?: string[];
  childRuns?: Array<{
    jobId: string;
    endedAtMs: number;
    status: "done" | "cancelled" | "error" | "stopped";
    summary: OptimizerJobHistoryRecord["summary"];
    runPayload: OptimizerJobHistoryRecord["runPayload"];
  }>;
  endedAtMs: number;
  status: "done" | "cancelled" | "error" | "stopped";
  runPayload: {
    selectedBotId?: string;
    selectedBotPresetId?: string;
    datasetMode?: "snapshot" | "followTail";
    datasetHistoryIds: string[];
    optTfMin?: number;
    timeRangeFromTs?: number;
    timeRangeToTs?: number;
    candidates: number;
    seed: number;
    minTrades: number;
    directionMode: "both" | "long" | "short";
    executionModel?: "closeOnly" | "conservativeOhlc";
    rememberNegatives: boolean;
    excludeNegative: boolean;
    datasetHours?: number;
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
let sessionStartAbortController: AbortController | null = null;
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
  const rawDatasetHistoryIds = Array.isArray((runPayload as any)?.datasetHistoryIds) ? (runPayload as any).datasetHistoryIds : [];
  const datasetHistoryIds = rawDatasetHistoryIds.map((id: unknown) => String(id ?? "")).filter(Boolean);
  return {
    ...(typeof (runPayload as any)?.selectedBotId === "string" ? { selectedBotId: String((runPayload as any).selectedBotId) } : {}),
    ...(typeof (runPayload as any)?.selectedBotPresetId === "string" ? { selectedBotPresetId: String((runPayload as any).selectedBotPresetId) } : {}),
    ...(["snapshot", "followTail"].includes(String((runPayload as any)?.datasetMode))
      ? { datasetMode: String((runPayload as any).datasetMode) as "snapshot" | "followTail" }
      : {}),
    ...(typeof (runPayload as any)?.loopId === "string" ? { loopId: String((runPayload as any).loopId) } : {}),
    datasetHistoryIds,
    ...(Number.isFinite(Number((runPayload as any)?.optTfMin)) ? { optTfMin: Math.floor(Number((runPayload as any)?.optTfMin)) } : {}),
    ...(Number.isFinite(Number((runPayload as any)?.timeRangeFromTs)) ? { timeRangeFromTs: Math.floor(Number((runPayload as any)?.timeRangeFromTs)) } : {}),
    ...(Number.isFinite(Number((runPayload as any)?.timeRangeToTs)) ? { timeRangeToTs: Math.floor(Number((runPayload as any)?.timeRangeToTs)) } : {}),
    candidates: Math.max(0, Math.floor(Number((runPayload as any)?.candidates) || 0)),
    seed: Number((runPayload as any)?.seed) || 1,
    minTrades: Math.max(0, Math.floor(Number((runPayload as any)?.minTrades) || 0)),
    directionMode: ["both", "long", "short"].includes(String((runPayload as any)?.directionMode)) ? String((runPayload as any)?.directionMode) as "both" | "long" | "short" : "both",
    ...(["closeOnly", "conservativeOhlc"].includes(String((runPayload as any)?.executionModel)) ? { executionModel: String((runPayload as any)?.executionModel) as "closeOnly" | "conservativeOhlc" } : {}),
    rememberNegatives: Boolean((runPayload as any)?.rememberNegatives),
    excludeNegative: Boolean((runPayload as any)?.excludeNegative),
    ...(Number.isFinite(Number((runPayload as any)?.datasetHours)) ? { datasetHours: Math.max(0, Math.floor(Number((runPayload as any)?.datasetHours))) } : {}),
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
    slippageBps,
  };
}


function parseExecutionModel(raw: unknown): "closeOnly" | "conservativeOhlc" {
  if (raw == null || String(raw).trim() === "") return "closeOnly";
  const value = String(raw);
  if (value === "closeOnly" || value === "conservativeOhlc") return value;
  throw new Error("invalid_execution_model");
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
    ...(mode === "loop" ? { loopId: String((job.runPayload as any)?.loopId ?? optimizerLoopState?.loopId ?? "") } : {}),
    historyType: "run",
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

export function aggregateOptimizerHistorySessions(records: OptimizerJobHistoryRecord[]): OptimizerJobHistoryRecord[] {
  const loopGroups = new Map<string, OptimizerJobHistoryRecord[]>();
  const singles: OptimizerJobHistoryRecord[] = [];
  for (const row of records) {
    if (row.mode !== "loop" || !row.loopId) {
      singles.push(row);
      continue;
    }
    const key = String(row.loopId);
    const group = loopGroups.get(key) ?? [];
    group.push(row);
    loopGroups.set(key, group);
  }
  const sessions: OptimizerJobHistoryRecord[] = [];
  for (const [loopId, group] of loopGroups.entries()) {
    const sorted = [...group].sort((a, b) => Number(b.endedAtMs) - Number(a.endedAtMs));
    const latest = sorted[0];
    if (!latest) continue;
    const bestNetPnl = sorted.reduce<number | null>((acc, row) => {
      const current = row.summary.bestNetPnl;
      if (current == null || !Number.isFinite(current)) return acc;
      if (acc == null || current > acc) return current;
      return acc;
    }, null);
    const runsTotal = sorted.length;
    const runsCompleted = sorted.filter((row) => ["done", "cancelled", "stopped", "error"].includes(row.status)).length;
    const rowsPositive = sorted.reduce((sum, row) => sum + Math.max(0, Number(row.summary.rowsPositive) || 0), 0);
    const rowsTotal = sorted.reduce((sum, row) => sum + Math.max(0, Number(row.summary.rowsTotal) || 0), 0);
    sessions.push({
      ...latest,
      jobId: `loop:${loopId}`,
      loopId,
      historyType: "session",
      sessionRunsTotal: runsTotal,
      sessionRunsCompleted: runsCompleted,
      childJobIds: sorted.map((row) => row.jobId),
      childRuns: sorted.map((row) => ({
        jobId: row.jobId,
        endedAtMs: row.endedAtMs,
        status: row.status,
        summary: row.summary,
        runPayload: row.runPayload,
      })),
      summary: {
        ...latest.summary,
        bestNetPnl,
        rowsPositive,
        rowsTotal,
      },
    });
  }
  return [...sessions, ...singles].sort((a, b) => Number(b.endedAtMs) - Number(a.endedAtMs));
}



function optimizerResultSignature(row: OptimizerResult): string {
  const stableRowId = typeof (row as any)?.rowId === "string" ? (row as any).rowId.trim() : "";
  if (stableRowId) return stableRowId;
  return [
    Number(row?.params?.priceThresholdPct ?? 0),
    Number(row?.params?.oivThresholdPct ?? 0),
    Number(row?.params?.tpRoiPct ?? 0),
    Number(row?.params?.slRoiPct ?? 0),
    Number(row?.params?.entryOffsetPct ?? 0),
    Number(row?.params?.timeoutSec ?? 0),
    Number(row?.params?.rearmMs ?? 0),
  ].join("|");
}

function mergeJobResults(existing: OptimizerResult[], incoming: OptimizerResult[], maxRows: number): OptimizerResult[] {
  const merged = new Map<string, OptimizerResult>();
  for (const row of Array.isArray(existing) ? existing : []) {
    merged.set(optimizerResultSignature(row), row);
  }
  for (const row of Array.isArray(incoming) ? incoming : []) {
    merged.set(optimizerResultSignature(row), row);
  }
  return Array.from(merged.values()).slice(0, Math.max(1, maxRows));
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
    const restoredPct = parsed.status === "done" ? 100 : 0;
    const job: OptimizerJob = {
      status: wasRunning ? "paused" : parsed.status,
      total: 100,
      done: restoredPct,
      lastPct: restoredPct,
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
      runKey: `datasets=${Array.isArray((parsed.runPayload as any)?.datasetHistoryIds) ? [...(parsed.runPayload as any).datasetHistoryIds].sort().join(",") : ""}|dir=${String((parsed.runPayload as any)?.directionMode ?? "both")}|tf=${Number((parsed.runPayload as any)?.optTfMin ?? 0) || 0}`,
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

function ensureDefaultBotPresetSelected(botId?: string): string {
  const cfg = configStore.get();
  const resolvedBotId = botId ? getBotDefinition(botId).id : cfg.selectedBotId;
  const fallbackConfig = cfg.selectedBotId === resolvedBotId
    ? cfg.botConfig
    : getBotDefinition(resolvedBotId).defaults;
  ensureDefaultBotPreset(resolvedBotId, fallbackConfig);
  const selectedNow = configStore.get();
  if (selectedNow.selectedBotId === resolvedBotId && selectedNow.selectedBotPresetId !== DEFAULT_BOT_PRESET_ID) {
    configStore.setSelections({ selectedBotPresetId: DEFAULT_BOT_PRESET_ID });
    configStore.persist();
  }
  return DEFAULT_BOT_PRESET_ID;
}

function tryReadOptimizerJobSnapshot(jobId: string): OptimizerJobSnapshot | null {
  const trimmed = String(jobId ?? "").trim();
  if (!trimmed) return null;
  const snapshotPath = optimizerJobSnapshotPath(trimmed);
  if (!fs.existsSync(snapshotPath)) return null;
  try {
    const raw = fs.readFileSync(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as OptimizerJobSnapshot;
    if (!parsed?.jobId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hydrateJobFromSnapshot(snapshot: OptimizerJobSnapshot): OptimizerJob {
  const wasRunning = snapshot.status === "running";
  const now = Date.now();
  const restoredPct = snapshot.status === "done" ? 100 : 0;
  return {
    status: wasRunning ? "paused" : snapshot.status,
    total: 100,
    done: restoredPct,
    lastPct: restoredPct,
    cancelRequested: false,
    pauseRequested: false,
    paused: wasRunning || snapshot.status === "paused",
    resumeRequested: false,
    results: Array.isArray(snapshot.results) ? snapshot.results : [],
    minTrades: Math.max(0, Math.floor(Number((snapshot.runPayload as any)?.minTrades) || 0)),
    startedAtMs: Number(snapshot.startedAtMs) || now,
    updatedAtMs: Number(snapshot.updatedAtMs) || now,
    processedCandidates: 0,
    totalCandidates: Math.max(0, Math.floor(Number((snapshot.runPayload as any)?.candidates) || 0)),
    excludeNegative: Boolean((snapshot.runPayload as any)?.excludeNegative),
    rememberNegatives: Boolean((snapshot.runPayload as any)?.rememberNegatives),
    runKey: `datasets=${Array.isArray((snapshot.runPayload as any)?.datasetHistoryIds) ? [...(snapshot.runPayload as any).datasetHistoryIds].sort().join(",") : ""}|dir=${String((snapshot.runPayload as any)?.directionMode ?? "both")}|tf=${Number((snapshot.runPayload as any)?.optTfMin ?? 0) || 0}`,
    finishedAtMs: typeof snapshot.finishedAtMs === "number" ? snapshot.finishedAtMs : null,
    runPayload: snapshot.runPayload,
    ...(typeof snapshot.message === "string" ? { message: snapshot.message } : {}),
  };
}

function resolveOptimizerJob(jobId: string): OptimizerJob | null {
  const inMemory = optimizerJobs.get(jobId);
  if (inMemory) return inMemory;
  const snapshot = tryReadOptimizerJobSnapshot(jobId);
  if (!snapshot) return null;
  const hydrated = hydrateJobFromSnapshot(snapshot);
  optimizerJobs.set(jobId, hydrated);
  rememberOptimizerJob(jobId);
  return hydrated;
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
    if (["priceTh", "oivTh", "tp", "sl", "offset"].includes(String(key)) && (min < 0 || max < 0)) {
      throw new Error(`invalid_range_${String(key)}`);
    }
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

function assertOptimizerMinimumRanges(ranges: OptimizerRanges | undefined) {
  const timeoutRange = ranges?.timeoutSec;
  if (timeoutRange && (!Number.isFinite(timeoutRange.min) || !Number.isFinite(timeoutRange.max) || timeoutRange.min < 61 || timeoutRange.max < 61)) {
    throw new Error("invalid_range_timeoutSec");
  }
  const rearmRange = ranges?.rearmMs;
  if (rearmRange && (!Number.isFinite(rearmRange.min) || !Number.isFinite(rearmRange.max) || rearmRange.min < 900000 || rearmRange.max < 900000)) {
    throw new Error("invalid_range_rearmMs");
  }
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
  const sortKey = ["netPnl", "trades", "trainNetPnl", "trainTrades", "valNetPnl", "valTrades", "valPnlPerTrade", "winRatePct", "expectancy", "profitFactor", "maxDrawdownUsdt", "ordersPlaced", "ordersFilled", "ordersExpired", "longsCount", "longsPnl", "longsWinRatePct", "shortsCount", "shortsPnl", "shortsWinRatePct", "priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs"].includes(String(query.sortKey))
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

function buildLoopProgressState(jobId: string, status: OptimizerLoopProgressState["status"], runIndex: number, runTotal: number, runPct: number): OptimizerLoopProgressState {
  const safeRunTotal = Math.max(1, runTotal);
  const safeRunIndex = Math.max(0, runIndex);
  const clampedRunPct = Math.max(0, Math.min(100, Math.round(runPct * 100) / 100));
  const completedRuns = Math.min(safeRunTotal, Math.max(0, safeRunIndex - 1));
  const overallRaw = ((completedRuns + (clampedRunPct / 100)) / safeRunTotal) * 100;
  const overallPct = status === "done" ? 100 : Math.max(0, Math.min(100, Math.round(overallRaw * 100) / 100));
  return {
    jobId,
    status,
    runIndex: safeRunIndex,
    runTotal: safeRunTotal,
    runPct: status === "done" ? 100 : clampedRunPct,
    overallPct,
    updatedAt: Date.now(),
  };
}

function updateLoopProgressState(patch: Partial<OptimizerLoopProgressState> | null) {
  if (!optimizerLoopState) return;
  if (!patch) return;
  const current = optimizerLoopState.progress;
  if (!current) {
    if (!patch.jobId || !patch.status || patch.runIndex == null || patch.runTotal == null || patch.runPct == null || patch.overallPct == null || patch.updatedAt == null) {
      return;
    }
    updateLoopState({ progress: patch as OptimizerLoopProgressState });
    return;
  }
  updateLoopState({ progress: { ...current, ...patch } });
}

async function startLoopJob(app: FastifyInstance) {
  if (!optimizerLoopState || !optimizerLoopState.isRunning || optimizerLoopState.isPaused) return;
  const state = optimizerLoopState;
  if (!state.isInfinite && state.runIndex >= state.runsCount) {
    updateLoopState({ isRunning: false, isPaused: false });
    return;
  }
  const payloadWithLoopSeed = {
    ...(state.runPayload as Record<string, unknown>),
    loopIndex: state.loopIndex,
    loopId: state.loopId,
  };
  let resolvedPayload: Record<string, unknown>;
  try {
    resolvedPayload = withDatasetResolved(payloadWithLoopSeed);
  } catch (e: any) {
    updateLoopState({
      isRunning: false,
      isPaused: false,
      lastError: {
        statusCode: 400,
        bodySnippet: String(e?.message ?? e).slice(0, 300),
      },
    });
    return;
  }
  const res = await app.inject({ method: "POST", url: "/api/optimizer/run", payload: resolvedPayload });
  if (res.statusCode !== 200) {
    updateLoopState({
      isRunning: false,
      isPaused: false,
      lastError: {
        statusCode: res.statusCode,
        bodySnippet: String(res.body ?? "").slice(0, 300),
      },
    });
    return;
  }
  const parsed = JSON.parse(res.body || "{}") as { jobId?: string };
  if (!parsed.jobId) {
    updateLoopState({
      isRunning: false,
      isPaused: false,
      lastError: {
        statusCode: 200,
        bodySnippet: "missing jobId in /api/optimizer/run response",
      },
    });
    return;
  }
  const nextRunIndex = state.runIndex + 1;
  const runTotal = state.isInfinite ? Math.max(nextRunIndex, 1) : Math.max(1, state.runsCount);
  updateLoopState({
    lastJobId: parsed.jobId,
    lastError: null,
    progress: buildLoopProgressState(parsed.jobId, "running", nextRunIndex, runTotal, 0),
  });
}

async function tickOptimizerLoop(app: FastifyInstance) {
  const state = optimizerLoopState;
  if (!state || !state.isRunning || state.isPaused) return;

  if (state.lastJobId) {
    const job = optimizerJobs.get(state.lastJobId);
    if (job && !isOptimizerJobTerminal(job.status)) return;
    updateLoopState({ runIndex: state.runIndex + 1, loopIndex: state.loopIndex + 1, lastJobId: null });
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
    donePercent: Math.max(0, Math.min(100, Number(job.done) || 0)),
    ...(job.message ? { message: job.message } : {}),
  };
}

function finalizeLoopForTerminalJob(jobId: string) {
  const state = optimizerLoopState;
  if (!state || !state.isRunning || state.lastJobId !== jobId) return;
  updateLoopState({ runIndex: state.runIndex + 1, loopIndex: state.loopIndex + 1, lastJobId: null });
}

function normalizeOptionalTs(value: unknown): number | undefined {
  if (value == null || String(value).trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}


function cachePathForSymbolInterval(symbol: string, interval: string): string {
  return path.resolve(process.cwd(), "data", "cache", "bybit_klines", interval, `${symbol}.jsonl`);
}

function resolveDatasetCachePath(symbol: string, interval: string): string {
  const scoped = cachePathForSymbolInterval(symbol, interval);
  if (fs.existsSync(scoped)) return scoped;
  if (interval === "1") {
    const legacy = path.resolve(process.cwd(), "data", "cache", "bybit_klines", `${symbol}.jsonl`);
    if (fs.existsSync(legacy)) return legacy;
  }
  return scoped;
}

const DATASET_INTERVAL_ORDER: Record<string, number> = {
  "1": 1,
  "3": 2,
  "5": 3,
  "15": 4,
  "30": 5,
  "60": 6,
  "120": 7,
  "240": 8,
  "360": 9,
  "720": 10,
  D: 11,
  W: 12,
  M: 13,
};

function getDatasetIntervalRank(interval: string): number {
  return DATASET_INTERVAL_ORDER[String(interval ?? "1")] ?? 0;
}

function chooseMaxInterval(histories: Array<{ interval?: string }>): string {
  const intervals = [...new Set(histories.map((h) => String(h.interval ?? "1")))];
  if (!intervals.length) return "1";
  return intervals.sort((a, b) => getDatasetIntervalRank(b) - getDatasetIntervalRank(a))[0] ?? "1";
}

function computeDatasetHoursFromHistories(histories: Array<{ startMs: number; endMs: number }>): number {
  const sorted = histories
    .map((h) => ({ startMs: Number(h.startMs), endMs: Number(h.endMs) }))
    .filter((h) => Number.isFinite(h.startMs) && Number.isFinite(h.endMs) && h.endMs >= h.startMs)
    .sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));

  if (!sorted.length) return 0;

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...window });
      continue;
    }
    if (window.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, window.endMs);
      continue;
    }
    merged.push({ ...window });
  }

  const totalMs = merged.reduce((acc, window) => acc + Math.max(0, window.endMs - window.startMs), 0);
  return Math.round((totalMs / 3_600_000) * 100) / 100;
}

function buildDatasetRunKey(input: {
  selectedBotId?: string;
  selectedBotPresetId?: string;
  datasetHistoryIds: string[];
  directionMode: string;
  optTfMin: number | undefined;
  candidates: number;
  seed: number;
  executionModel?: "closeOnly" | "conservativeOhlc";
  datasetMode?: "snapshot" | "followTail";
}) {
  const normalizedHistoryIds = [...input.datasetHistoryIds].map((id) => String(id ?? "").trim()).filter(Boolean).sort();
  const raw = [
    `bot=${input.selectedBotId ?? DEFAULT_BOT_ID}`,
    `botPreset=${input.selectedBotPresetId ?? "default"}`,
    `hist=${normalizedHistoryIds.join(",")}`,
    `dir=${input.directionMode}`,
    `tf=${input.optTfMin ?? 0}`,
    `c=${Math.floor(input.candidates)}`,
    `s=${Number.isFinite(input.seed) ? input.seed : 1}`,
    `exec=${input.executionModel ?? "closeOnly"}`,
    `datasetMode=${input.datasetMode ?? "snapshot"}`,
  ].join("|");
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `datasetHist=${digest}`;
}

export function resolveOptimizerDatasetWindow(runPayload: Record<string, unknown>, nowMs = Date.now()): Record<string, unknown> {
  const modeRaw = runPayload.datasetMode;
  const mode = modeRaw == null || String(modeRaw).trim() === ""
    ? "snapshot"
    : String(modeRaw);
  if (mode !== "snapshot" && mode !== "followTail") {
    throw new Error("invalid_dataset_mode");
  }
  if (mode === "snapshot") {
    return {
      ...runPayload,
      datasetMode: "snapshot",
    };
  }
  const fromTs = normalizeOptionalTs((runPayload as any).timeRangeFromTs);
  if (!Number.isFinite(fromTs as number) || (fromTs as number) <= 0) {
    throw new Error("invalid_follow_tail_start");
  }
  const from = Math.floor(fromTs as number);
  const to = Math.max(from + 1, Math.floor(nowMs));
  return {
    ...runPayload,
    datasetMode: "followTail",
    timeRangeFromTs: from,
    timeRangeToTs: to,
  };
}

function withDatasetResolved(runPayload: Record<string, unknown>): Record<string, unknown> {
  return resolveOptimizerDatasetWindow(runPayload);
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

  app.get("/api/bots", async () => {
    return { bots: listBots(), selectedBotId: configStore.get().selectedBotId };
  });

  app.get("/api/config/selections", async () => {
    ensureDefaultBotPresetSelected();
    const cfg = configStore.get();
    return {
      selectedBotId: cfg.selectedBotId,
      selectedBotPresetId: cfg.selectedBotPresetId,
      selectedExecutionProfileId: cfg.selectedExecutionProfileId,
    };
  });

  app.post("/api/config/selections", async (req, reply) => {
    const body = safeBody((req as any).body) as Record<string, unknown>;
    try {
      const selectionPatch: { selectedBotId?: string; selectedBotPresetId?: string; selectedExecutionProfileId?: string } = {};
      if (typeof body.selectedBotId === "string") selectionPatch.selectedBotId = body.selectedBotId;
      if (typeof body.selectedBotPresetId === "string") selectionPatch.selectedBotPresetId = body.selectedBotPresetId;
      if (typeof body.selectedExecutionProfileId === "string") selectionPatch.selectedExecutionProfileId = body.selectedExecutionProfileId;
      const next = configStore.setSelections(selectionPatch);
      ensureDefaultBotPresetSelected(next.selectedBotId);
      configStore.persist();
      const cfg = configStore.get();
      return {
        selectedBotId: cfg.selectedBotId,
        selectedBotPresetId: cfg.selectedBotPresetId,
        selectedExecutionProfileId: cfg.selectedExecutionProfileId,
      };
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_config_selection", message: String(e?.message ?? e) };
    }
  });


  setOptimizerSnapshotProvider(() => {
    const jobId = resolveCurrentOptimizerJobId();
    if (!jobId) return { jobId: null, rows: [] };
    const job = optimizerJobs.get(jobId);
    return { jobId, rows: Array.isArray(job?.results) ? job!.results : [] };
  });

  app.get("/api/doctor", async () => {
    const warnings: string[] = [];
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

  app.post("/api/session/start", async (req, reply) => {
    const body = safeBody((req as any).body) as Record<string, unknown>;
    const selectedBotId = typeof body.selectedBotId === "string" ? body.selectedBotId : undefined;
    const selectedBotPresetId = typeof body.selectedBotPresetId === "string" ? body.selectedBotPresetId : undefined;
    const selectedExecutionProfileId = typeof body.selectedExecutionProfileId === "string" ? body.selectedExecutionProfileId : undefined;
    if (selectedBotId || selectedBotPresetId || selectedExecutionProfileId) {
      const selectionPatch: { selectedBotId?: string; selectedBotPresetId?: string; selectedExecutionProfileId?: string } = {};
      if (selectedBotId) selectionPatch.selectedBotId = selectedBotId;
      if (selectedBotPresetId) selectionPatch.selectedBotPresetId = selectedBotPresetId;
      if (selectedExecutionProfileId) selectionPatch.selectedExecutionProfileId = selectedExecutionProfileId;
      configStore.setSelections(selectionPatch);
    }
    ensureDefaultBotPresetSelected(selectedBotId);
    const selections = configStore.get();
    if (selections.selectedBotPresetId) {
      const preset = readBotPreset(selections.selectedBotId, selections.selectedBotPresetId);
      configStore.applyProfiles({ botConfig: preset.botConfig });
    }
    if (selections.selectedExecutionProfileId) {
      const profile = readExecutionProfile(selections.selectedExecutionProfileId);
      configStore.applyProfiles({ executionProfile: profile.executionProfile });
    }
    configStore.persist();
    const cfg = configStore.get();
    const id = String((cfg as any)?.universe?.selectedId ?? "");
    const symbols = Array.isArray((cfg as any)?.universe?.symbols) ? (cfg as any).universe.symbols : [];

    if (!id || symbols.length === 0) {
      reply.code(409);
      return { error: "universe_not_selected", message: "Select a Universe and click Apply before starting." };
    }

    if (sessionStartAbortController) sessionStartAbortController.abort();
    const abortController = new AbortController();
    sessionStartAbortController = abortController;

    try {
      const status = await runtime.start({
        waitForReady: async ({ signal }) => {
          await awaitAllStreamsConnected({ timeoutMs: 20_000, signal });
        },
      });

      if (status.sessionState !== "RUNNING") {
        reply.code(503);
        return { error: "streams_not_ready", message: "Failed to connect all required streams before start timeout." };
      }

      return status;
    } finally {
      if (sessionStartAbortController === abortController) {
        sessionStartAbortController = null;
      }
    }
  });

  app.post("/api/session/stop", async () => {
    if (sessionStartAbortController) {
      sessionStartAbortController.abort();
      sessionStartAbortController = null;
    }
    return await runtime.stop();
  });
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
      const body = safeBody((req as any).body) as Record<string, unknown>;
      if (body?.interval != null) {
        const interval = String(body.interval).trim();
        if (!["1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W", "M"].includes(interval)) {
          reply.code(400);
          return { error: "invalid_interval", message: "Invalid dataset interval." };
        }
      }
      if (body?.range != null) {
        const range = body.range;
        if (!range || typeof range !== "object") {
          reply.code(400);
          return { error: "invalid_range", message: "Invalid dataset range payload." };
        }
        const row = range as Record<string, unknown>;
        const kind = typeof row.kind === "string" ? row.kind : "";
        if (kind === "manual") {
          const startMs = Number(row.startMs);
          const endMs = Number(row.endMs);
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || Math.floor(endMs) <= Math.floor(startMs)) {
            reply.code(400);
            return { error: "invalid_range", message: "Manual range must have endMs > startMs." };
          }
        } else if (kind === "preset") {
          const preset = typeof row.preset === "string" ? row.preset : "";
          if (!["6h", "12h", "24h", "48h", "1w", "2w", "4w", "1mo"].includes(preset)) {
            reply.code(400);
            return { error: "invalid_range", message: "Invalid dataset preset range." };
          }
        } else {
          reply.code(400);
          return { error: "invalid_range", message: "Range kind must be preset or manual." };
        }
      }
      const normalized = normalizeDatasetTarget((req as any).body);
      writeDatasetTarget(normalized);
      return { datasetTarget: normalized };
    } catch (e: any) {
      reply.code(400);
      return { error: "dataset_target_error", message: String(e?.message ?? "Failed to persist dataset target.") };
    }
  });

  app.get("/api/providers/capabilities", async (req) => {
    const query = req.query as Record<string, unknown>;
    const botId = typeof query?.botId === "string" ? query.botId : configStore.get().selectedBotId;
    const checks = await collectProviderCapabilities({ botId });
    const requiredChecks = checks.filter((row) => row.required);
    const requiredOk = requiredChecks.every((row) => row.available);
    return {
      ok: requiredOk,
      nowMs: Date.now(),
      bybitRestUrl: process.env.BYBIT_REST_URL ?? "https://api.bybit.com",
      coinglassBaseUrl: process.env.COINGLASS_BASE_URL ?? "https://open-api-v3.coinglass.com",
      checks,
      summary: {
        total: checks.length,
        available: checks.filter((row) => row.available).length,
        requiredTotal: requiredChecks.length,
        requiredAvailable: requiredChecks.filter((row) => row.available).length,
      },
    };
  });

  app.get("/api/process/status", async () => {
    const runtimeStatus = runtime.getStatus();
    const loop = optimizerLoopState;
    const receive = getActiveReceiveDataJob();
    const oiRecorder = minuteOiRecorder.getStatus();
    const cvd = cvdRecorder.getStatus();
    const currentJobId = resolveCurrentOptimizerJobId();
    const currentJob = currentJobId ? optimizerJobs.get(currentJobId) : null;
    const loopProgress = loop?.progress && typeof loop.progress === "object" ? loop.progress : null;
    return {
      runtime: {
        state: runtimeStatus.sessionState,
        runningSinceMs: runtimeStatus.runningSinceMs ?? null,
        message: runtimeStatus.runtimeMessage ?? null,
      },
      optimizer: {
        state: loop?.isRunning ? (loop.isPaused ? "paused" : "running") : "stopped",
        runIndex: loop?.runIndex ?? 0,
        runsCount: loop?.runsCount ?? 0,
        isInfinite: Boolean(loop?.isInfinite),
        currentJobId: currentJobId ?? null,
        jobStatus: currentJob?.status ?? null,
        progressPct: loopProgress?.overallPct ?? (currentJob?.done ?? 0),
        message: currentJob?.message ?? null,
      },
      receiveData: {
        state: receive?.status ?? "idle",
        jobId: receive?.id ?? null,
        progressPct: receive?.progress?.pct ?? 0,
        currentSymbol: receive?.progress?.currentSymbol ?? null,
        message: receive?.progress?.message ?? null,
        etaSec: receive?.progress?.etaSec ?? null,
      },
      recorder: {
        state: oiRecorder.state === "running" || cvd.state === "running" ? "running" : oiRecorder.state,
        mode: oiRecorder.mode,
        progressPct: null,
        message: oiRecorder.message,
        writes: (oiRecorder.writes ?? 0) + (cvd.writes1m ?? 0),
        droppedBoundaryPoints: oiRecorder.droppedBoundaryPoints,
        trackedSymbols: Math.max(oiRecorder.trackedSymbols ?? 0, cvd.trackedSymbols ?? 0),
        lastWriteAtMs: Math.max(oiRecorder.lastWriteAtMs ?? 0, cvd.lastWriteAtMs ?? 0) || null,
        cvd: {
          state: cvd.state,
          writes1s: cvd.writes1s,
          writes1m: cvd.writes1m,
          trackedSymbols: cvd.trackedSymbols,
          message: cvd.message,
          lastSeenTradeTs: cvd.lastSeenTradeTs,
        },
      },
    };
  });

  app.get("/api/recorder/status", async () => {
    const oi = minuteOiRecorder.getStatus();
    const cvd = cvdRecorder.getStatus();
    return {
      ...oi,
      cvd,
    };
  });

  app.get("/api/recorder/cvd/debug", async (req) => {
    const query = (req as any)?.query ?? {};
    const symbolsRaw = String(query?.symbols ?? "").trim();
    const symbols = symbolsRaw ? symbolsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    return cvdRecorder.getDebugSnapshot(symbols ? { symbols } : undefined);
  });

  app.get("/api/recorder/universe", async () => {
    return readRecorderUniverseState();
  });

  app.post("/api/recorder/universe", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    const selectedId = String(body?.selectedId ?? "").trim();
    if (selectedId) {
      const next = setRecorderUniverseById(selectedId);
      if (!next) {
        reply.code(400);
        return { error: "recorder_universe_not_found" };
      }
      requestStreamLifecycleSync();
      return next;
    }
    if (Array.isArray(body?.symbols)) {
      const next = setRecorderUniverseSymbols(body.symbols);
      requestStreamLifecycleSync();
      return next;
    }
    reply.code(400);
    return { error: "invalid_recorder_universe_payload" };
  });

  app.post("/api/recorder/mode", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    const mode = String(body?.mode ?? "").trim();
    if (mode !== "off" && mode !== "record_only" && mode !== "record_while_running") {
      reply.code(400);
      return { error: "invalid_recorder_mode" };
    }
    minuteOiRecorder.setMode(mode);
    cvdRecorder.setMode(mode);
    requestStreamLifecycleSync();
    const oi = minuteOiRecorder.getStatus();
    const cvd = cvdRecorder.getStatus();
    return { ok: true, recorder: { ...oi, cvd } };
  });

  app.post("/api/data/receive", async (req, reply) => {
    const body = ((req as any).body && typeof (req as any).body === "object") ? ((req as any).body as Record<string, unknown>) : undefined;
    let started;
    try {
      started = startReceiveDataJob(body as any);
    } catch (e: any) {
      reply.code(500);
      return { error: "receive_start_failed", message: String(e?.message ?? "Failed to start receive job.") };
    }
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

  
  // Dataset history (Receive Data snapshots metadata)
  app.get("/api/data/history", async () => {
    return { histories: listDatasetHistories() };
  });

  app.delete("/api/data/history/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      // Ensure it exists first (stable 404)
      readDatasetHistory(id);
      deleteDatasetHistory(id);
      return { ok: true };
    } catch {
      reply.code(404);
      return { error: "history_not_found" };
    }
  });

app.get("/api/config", async () => {
    return { config: configStore.get() };
  });

  app.post("/api/config", async (req, reply) => {
    const patch = safeBody((req as any).body) as Record<string, unknown>;
    const normalizedPatch: Record<string, unknown> = { ...patch };
    const paperPatchRaw = patch?.paper;
    if (paperPatchRaw && typeof paperPatchRaw === "object") {
      const paperPatch = { ...(paperPatchRaw as Record<string, unknown>) };
      if (paperPatch.rearmSec != null) {
        delete paperPatch.rearmSec;
      }
      if (paperPatch.rearmDelayMs != null) {
        const rawRearmDelayMs = Number(paperPatch.rearmDelayMs);
        if (!Number.isFinite(rawRearmDelayMs) || Math.floor(rawRearmDelayMs) < 0) {
          reply.code(400);
          return { error: "invalid_config", message: "paper.rearmDelayMs must be a non-negative integer." };
        }
        paperPatch.rearmDelayMs = Math.floor(rawRearmDelayMs);
      }
      if (paperPatch.entryTimeoutSec != null) {
        const raw = Number(paperPatch.entryTimeoutSec);
        if (!Number.isFinite(raw) || Math.floor(raw) < 1) {
          reply.code(400);
          return { error: "invalid_config", message: "paper.entryTimeoutSec must be an integer >= 1." };
        }
        paperPatch.entryTimeoutSec = Math.floor(raw);
      }
      normalizedPatch.paper = paperPatch;
    }
    const cur = configStore.get();

    if (universeWouldChange(cur, patch) && runtime.isRunning()) {
      reply.code(409);
      return {
        error: "universe_change_requires_stopped_session",
        message: "Universe (symbols/klineTfMin) can be changed only when session is STOPPED."
      };
    }

    try {
      const config = configStore.update(normalizedPatch);

      try {
        configStore.persist();
      } catch (e: any) {
        app.log.error({ err: e }, "failed to persist runtime config");
        reply.code(500);
        return { error: "config_persist_failed", message: String(e?.message ?? e) };
      }

      const uChanged = universeWouldChange(cur, normalizedPatch);
      const runtimeState = runtime.getStatus().sessionState;
      const runtimeActive = runtimeState === "RUNNING" || runtimeState === "PAUSED" || runtimeState === "RESUMING";
      let paperApplyMode: "next_session" | "next_trades" = "next_session";
      if (runtimeActive) {
        const applied = runtime.applyConfigForNextTrades({
          enabled: config.paper.enabled,
          directionMode: config.paper.directionMode,
          marginUSDT: config.paper.marginUSDT,
          leverage: config.paper.leverage,
          entryOffsetPct: config.paper.entryOffsetPct,
          entryTimeoutSec: config.paper.entryTimeoutSec,
          tpRoiPct: config.paper.tpRoiPct,
          slRoiPct: config.paper.slRoiPct,
          rearmDelayMs: config.paper.rearmDelayMs,
          maxDailyLossUSDT: config.paper.maxDailyLossUSDT,
        });
        if (applied.applied) paperApplyMode = "next_trades";
      }

      return {
        config,
        applied: {
          universe: uChanged ? "streams_reconnect" : "no_change",
          signals: true,
          fundingCooldown: true,
          paper: paperApplyMode
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
    const metricsRange = normalizeUniverseMetricsRange(body?.metricsRange);

    if (!Number.isFinite(minTurnoverUsd) || minTurnoverUsd < 0) {
      reply.code(400);
      return { error: "invalid_minTurnoverUsd" };
    }
    if (!Number.isFinite(minVolatilityPct) || minVolatilityPct < 0) {
      reply.code(400);
      return { error: "invalid_minVolatilityPct" };
    }

    const { id, name } = formatUniverseName(minTurnoverUsd, minVolatilityPct, metricsRange);

    try {
      const symbols = await seedLinearUsdtPerpSymbols({ restBaseUrl: "https://api.bybit.com" });

      const res = await buildUniverseByAverageMetrics({
        restBaseUrl: "https://api.bybit.com",
        symbols,
        minTurnoverUsd,
        minVolatilityPct,
        range: metricsRange,
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
          metricsRange,
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

  app.get("/api/universes/:id/symbol-summary", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      const universe = readUniverse(id);
      const selectedRange = normalizeUniverseMetricsRange((req.query as any)?.range ?? universe.meta.metricsRange ?? "24h");
      const summary = await buildUniverseSymbolRangeSummary({
        restBaseUrl: "https://api.bybit.com",
        symbols: universe.symbols,
        range: selectedRange,
      });
      return { universeId: id, range: summary.range, rows: summary.rows };
    } catch (e: any) {
      reply.code(404);
      return { error: "universe_not_found", message: String(e?.message ?? e) };
    }
  });

  app.get("/api/bot-presets", async (req, reply) => {
    const botId = String((req.query as any)?.botId ?? configStore.get().selectedBotId ?? DEFAULT_BOT_ID);
    try {
      ensureDefaultBotPresetSelected(botId);
      return {
        presets: listBotPresets(botId).map((p) => ({ id: p.id, botId: p.botId, name: p.name, updatedAt: p.updatedAt })),
      };
    } catch (e: any) {
      reply.code(400);
      return { error: "bot_presets_list_failed", message: String(e?.message ?? e) };
    }
  });

  app.get("/api/bot-presets/:id", async (req, reply) => {
    const botId = String((req.query as any)?.botId ?? configStore.get().selectedBotId ?? DEFAULT_BOT_ID);
    const id = String((req.params as any).id ?? "");
    try {
      ensureDefaultBotPresetSelected(botId);
      return readBotPreset(botId, id);
    } catch (e: any) {
      reply.code(404);
      return { error: "bot_preset_not_found", message: String(e?.message ?? e) };
    }
  });

  app.put("/api/bot-presets/:id", async (req, reply) => {
    const botId = String((req.query as any)?.botId ?? configStore.get().selectedBotId ?? DEFAULT_BOT_ID);
    const id = String((req.params as any).id ?? "");
    const body = safeBody((req as any).body) as any;
    const name = String(body?.name ?? "").trim();
    const botConfig = body?.botConfig;
    if (!name || !botConfig || typeof botConfig !== "object") {
      reply.code(400);
      return { error: "invalid_bot_preset_payload" };
    }
    try {
      return putBotPreset(botId, id, name, botConfig);
    } catch (e: any) {
      reply.code(400);
      return { error: "bot_preset_save_failed", message: String(e?.message ?? e) };
    }
  });

  app.delete("/api/bot-presets/:id", async (req, reply) => {
    const botId = String((req.query as any)?.botId ?? configStore.get().selectedBotId ?? DEFAULT_BOT_ID);
    const id = String((req.params as any).id ?? "");
    try {
      deleteBotPreset(botId, id);
      return { ok: true as const };
    } catch (e: any) {
      reply.code(404);
      return { error: "bot_preset_not_found", message: String(e?.message ?? e) };
    }
  });

  app.get("/api/execution-profiles", async () => {
    return { profiles: listExecutionProfiles().map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) };
  });

  app.get("/api/execution-profiles/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      return readExecutionProfile(id);
    } catch (e: any) {
      reply.code(404);
      return { error: "execution_profile_not_found", message: String(e?.message ?? e) };
    }
  });

  app.put("/api/execution-profiles/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    const body = safeBody((req as any).body) as any;
    const name = String(body?.name ?? "").trim();
    const executionProfile = body?.executionProfile;
    if (!name || !executionProfile || typeof executionProfile !== "object") {
      reply.code(400);
      return { error: "invalid_execution_profile_payload" };
    }
    try {
      return putExecutionProfile(id, name, executionProfile);
    } catch (e: any) {
      reply.code(400);
      return { error: "execution_profile_save_failed", message: String(e?.message ?? e) };
    }
  });

  app.delete("/api/execution-profiles/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      deleteExecutionProfile(id);
      return { ok: true as const };
    } catch (e: any) {
      reply.code(404);
      return { error: "execution_profile_not_found", message: String(e?.message ?? e) };
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

  app.get("/api/optimizer/status", async () => ({ dataSource: "receive_data_cache" as const }));

  app.post("/api/optimizer/run", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    const requestedBotId = typeof body?.selectedBotId === "string" ? body.selectedBotId : undefined;
    const requestedBotPresetId = typeof body?.selectedBotPresetId === "string" ? body.selectedBotPresetId : undefined;
    if (requestedBotId || requestedBotPresetId) {
      const selectionPatch: { selectedBotId?: string; selectedBotPresetId?: string } = {};
      if (requestedBotId) selectionPatch.selectedBotId = requestedBotId;
      if (requestedBotPresetId) selectionPatch.selectedBotPresetId = requestedBotPresetId;
      configStore.setSelections(selectionPatch);
    }
    ensureDefaultBotPresetSelected(requestedBotId);
    const currentCfg = configStore.get();
    if (currentCfg.selectedBotPresetId) {
      const preset = readBotPreset(currentCfg.selectedBotId, currentCfg.selectedBotPresetId);
      configStore.applyProfiles({ botConfig: preset.botConfig });
      configStore.persist();
    }
    const selectedBotId = configStore.get().selectedBotId;
    const selectedBotPresetId = configStore.get().selectedBotPresetId;

    const datasetHistoryIds: string[] = Array.isArray(body?.datasetHistoryIds)
      ? (body.datasetHistoryIds as any[]).map((v) => String(v ?? "").trim()).filter(Boolean)
      : [];

    if (!datasetHistoryIds.length) {
      reply.code(400);
      return { error: "dataset_history_missing", message: "Select at least one history row (Receive Data) before starting loop." };
    }

    const histories = [];
    for (const id of datasetHistoryIds) {
      try {
        histories.push(readDatasetHistory(id));
      } catch {
        reply.code(400);
        return { error: "dataset_history_not_found", message: `History not found: ${id}` };
      }
    }
    histories.sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs) || (a.receivedAtMs - b.receivedAtMs));

    const interval = chooseMaxInterval(histories);
    const chosenIntervalHistories = histories.filter((h) => String(h.interval ?? "1") === interval);
    const cacheDatasets = chosenIntervalHistories.map((h) => ({ symbols: h.receivedSymbols, startMs: h.startMs, endMs: h.endMs, interval }));
    if (cacheDatasets.some((ds) => !Array.isArray(ds.symbols) || ds.symbols.length === 0)) {
      reply.code(400);
      return { error: "dataset_history_symbols_missing", message: "Selected history contains no symbols." };
    }
    const allSymbols = new Set<string>();
    for (const ds of cacheDatasets) for (const s of ds.symbols) allSymbols.add(s);

    if (!allSymbols.size) {
      reply.code(400);
      return { error: "dataset_history_empty", message: "Selected history has no downloaded symbols." };
    }

    for (const symbol of allSymbols) {
      if (!fs.existsSync(resolveDatasetCachePath(symbol, "1"))) {
        reply.code(400);
        return { error: "dataset_cache_missing", message: "Dataset cache is missing (required: 1m cache). Run Receive Data again." };
      }
    }

    // count this loop start for each selected history
    incrementDatasetHistoryLoops(datasetHistoryIds, 1);

    const candidates = Number(body?.candidates);
    const seed = Number(body?.seed ?? 1);
    const directionMode = body?.directionMode == null ? "both" : String(body.directionMode);
    const optTfMinRaw = body?.optTfMin;
    const optTfMinParsed = optTfMinRaw == null || String(optTfMinRaw).trim() === "" ? 15 : Math.floor(Number(optTfMinRaw));
    if (!Number.isInteger(optTfMinParsed) || optTfMinParsed < 5 || optTfMinParsed > 240) {
      reply.code(400);
      return { error: "invalid_opt_tf_min" };
    }
    const optTfMin = optTfMinParsed;
    const minTradesRaw = body?.minTrades;
    const minTrades = minTradesRaw == null || String(minTradesRaw).trim() === "" ? 1 : Math.floor(Number(minTradesRaw));
    const excludeNegative = Boolean(body?.excludeNegative);
    const rememberNegatives = Boolean(body?.rememberNegatives);
    let sim: OptimizerSimulationParams;
    let executionModel: "closeOnly" | "conservativeOhlc";
    try {
      sim = parseSimParams(body?.sim);
      executionModel = parseExecutionModel(body?.executionModel);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }
    const datasetModeRaw = body?.datasetMode;
    const datasetMode = datasetModeRaw == null || String(datasetModeRaw).trim() === ""
      ? "snapshot"
      : String(datasetModeRaw);
    if (datasetMode !== "snapshot" && datasetMode !== "followTail") {
      reply.code(400);
      return { error: "invalid_dataset_mode" };
    }

    const runKey = buildDatasetRunKey({
      selectedBotId,
      selectedBotPresetId,
      datasetHistoryIds,
      directionMode,
      optTfMin,
      candidates: Number.isFinite(candidates) ? candidates : 0,
      seed,
      executionModel,
      datasetMode,
    });

    if (!Number.isFinite(candidates) || candidates < 1 || candidates > 2000) {
      reply.code(400);
      return { error: "invalid_candidates" };
    }
    if (!["both", "long", "short"].includes(directionMode)) {
      reply.code(400);
      return { error: "invalid_direction_mode" };
    }
    if (!Number.isFinite(minTrades) || minTrades < 0 || minTrades > 1_000_000) {
      reply.code(400);
      return { error: "invalid_min_trades" };
    }

    let ranges: OptimizerRanges | undefined;
    let precision: Partial<OptimizerPrecision> | undefined;
    try {
      ranges = parseRanges(body?.ranges);
      assertOptimizerMinimumRanges(ranges);
      precision = parsePrecision(body?.precision);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }

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
      jobId,
      runId: jobId,
      selectedBotId,
      selectedBotPresetId,
      datasetMode,
      datasetHistoryIds,
      cacheDatasets,
      interval,
      candidates: totalCandidates,
      seed: Number.isFinite(seed) ? seed : 1,
      ...(ranges ? { ranges } : {}),
      ...(precision ? { precision } : { precision: DEFAULT_OPTIMIZER_PRECISION }),
      directionMode: directionMode as "both" | "long" | "short",
      executionModel,
      optTfMin,
      minTrades,
      excludeNegative,
      rememberNegatives,
      datasetHours: computeDatasetHoursFromHistories(histories),
      sim,
    };
    job.runPayload = runPayload;
    let resolvedRunPayload: Record<string, unknown>;
    try {
      resolvedRunPayload = withDatasetResolved(runPayload as Record<string, unknown>);
    } catch (e: any) {
      optimizerJobs.delete(jobId);
      reply.code(400);
      return { error: "invalid_dataset_window", message: String(e?.message ?? e) };
    }

    try {
      optimizerWorkerManager.start(jobId, resolvedRunPayload, {
        onProgress: (msg) => {
          const now = Date.now();
          const donePercentRaw = Number((msg as any)?.donePercent);
          const hasDonePercent = Number.isFinite(donePercentRaw);

          // NOTE: the worker can emit progress-like messages that only contain `messageAppend`
          // (e.g. blacklist summary updates). Those must NOT reset `done`/`lastPct` to 0.
          if (hasDonePercent) {
            const pct2 = Math.max(0, Math.min(100, Math.round(donePercentRaw * 100) / 100));
            job.lastPct = Math.max(job.lastPct || 0, pct2);
            job.done = job.lastPct;
            job.total = 100;

            const doneCountRaw = Number((msg as any)?.done);
            const totalCountRaw = Number((msg as any)?.total);
            if (Number.isFinite(doneCountRaw)) job.processedCandidates = doneCountRaw;
            if (Number.isFinite(totalCountRaw) && totalCountRaw > 0) job.totalCandidates = totalCountRaw;

            const preview = Array.isArray((msg as any)?.previewResults) ? (msg as any).previewResults : [];
            const previewFiltered = preview.filter((r: any) => !job.excludeNegative || (r?.netPnl ?? 0) >= 0);
            if (previewFiltered.length > 0) {
              job.results = mergeJobResults(job.results, previewFiltered, 2000);
            }

            if (optimizerLoopState?.lastJobId === jobId && optimizerLoopState.progress?.jobId === jobId) {
              const state = optimizerLoopState;
              const runTotal = state.isInfinite ? Math.max(state.runIndex + 1, 1) : Math.max(1, state.runsCount);
              updateLoopProgressState(buildLoopProgressState(jobId, "running", state.runIndex + 1, runTotal, pct2));
            }
          }

          job.updatedAtMs = now;
          if (typeof (msg as any)?.messageAppend === "string" && (msg as any).messageAppend) {
            job.message = [job.message, String((msg as any).messageAppend)].filter(Boolean).join(" | ");
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
        onRowsAppend: (msg) => {
          const incomingRows = Array.isArray((msg as any)?.rows) ? (msg as any).rows : [];
          if (incomingRows.length === 0) return;
          const filtered = incomingRows.filter((r: any) => !job.excludeNegative || (r?.netPnl ?? 0) >= 0);
          if (!filtered.length) return;
          job.results = mergeJobResults(job.results, filtered, 2000);
          job.updatedAtMs = Date.now();
          writeCheckpoint(jobId, job);
          writeJobSnapshot(jobId, job);
          broadcastOptimizerRowsAppend(jobId, filtered);
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
            if (optimizerLoopState?.lastJobId === jobId) {
              const state = optimizerLoopState;
              const runTotal = state.isInfinite ? Math.max(state.runIndex + 1, 1) : Math.max(1, state.runsCount);
              updateLoopProgressState(buildLoopProgressState(jobId, "canceled", state.runIndex + 1, runTotal, job.done));
            }
          } else {
            job.lastPct = 100;
            job.done = 100;
            job.total = 100;
            job.status = "done";
            const totalStored = Array.isArray(job.results) ? job.results.length : 0;
            const tradedCandidates = totalStored > 0 ? job.results.filter((r) => (r?.trades ?? 0) > 0).length : 0;
            job.message = `Min trades filter: ${minTrades} | Candidates with trades>0: ${tradedCandidates}/${totalStored}`;
            if (optimizerLoopState?.lastJobId === jobId) {
              const state = optimizerLoopState;
              const runTotal = state.isInfinite ? Math.max(state.runIndex + 1, 1) : Math.max(1, state.runsCount);
              updateLoopProgressState(buildLoopProgressState(jobId, "done", state.runIndex + 1, runTotal, 100));
            }
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
          if (optimizerLoopState?.lastJobId === jobId) {
            const state = optimizerLoopState;
            const runTotal = state.isInfinite ? Math.max(state.runIndex + 1, 1) : Math.max(1, state.runsCount);
            updateLoopProgressState(buildLoopProgressState(jobId, "error", state.runIndex + 1, runTotal, job.done));
          }
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
    const requestedBotId = typeof body?.selectedBotId === "string" ? body.selectedBotId : undefined;
    const requestedBotPresetId = typeof body?.selectedBotPresetId === "string" ? body.selectedBotPresetId : undefined;
    if (requestedBotId || requestedBotPresetId) {
      const selectionPatch: { selectedBotId?: string; selectedBotPresetId?: string } = {};
      if (requestedBotId) selectionPatch.selectedBotId = requestedBotId;
      if (requestedBotPresetId) selectionPatch.selectedBotPresetId = requestedBotPresetId;
      configStore.setSelections(selectionPatch);
    }
    ensureDefaultBotPresetSelected(requestedBotId);
    const currentCfg = configStore.get();
    if (currentCfg.selectedBotPresetId) {
      const preset = readBotPreset(currentCfg.selectedBotId, currentCfg.selectedBotPresetId);
      configStore.applyProfiles({ botConfig: preset.botConfig });
      configStore.persist();
    }
    const selectedBotId = configStore.get().selectedBotId;
    const selectedBotPresetId = configStore.get().selectedBotPresetId;

    const datasetHistoryIds: string[] = Array.isArray(body?.datasetHistoryIds)
      ? (body.datasetHistoryIds as any[]).map((v) => String(v ?? "").trim()).filter(Boolean)
      : [];

    if (!datasetHistoryIds.length) {
      reply.code(400);
      return { error: "dataset_history_missing", message: "Select at least one history row (Receive Data) before starting loop." };
    }

    const histories = [];
    for (const id of datasetHistoryIds) {
      try {
        histories.push(readDatasetHistory(id));
      } catch {
        reply.code(400);
        return { error: "dataset_history_not_found", message: `History not found: ${id}` };
      }
    }
    histories.sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs) || (a.receivedAtMs - b.receivedAtMs));

    const interval = chooseMaxInterval(histories);
    const chosenIntervalHistories = histories.filter((h) => String(h.interval ?? "1") === interval);
    const cacheDatasets = chosenIntervalHistories.map((h) => ({ symbols: h.receivedSymbols, startMs: h.startMs, endMs: h.endMs, interval }));
    const allSymbols = new Set<string>();
    for (const ds of cacheDatasets) for (const s of ds.symbols) allSymbols.add(s);

    if (!allSymbols.size) {
      reply.code(400);
      return { error: "dataset_history_empty", message: "Selected history has no downloaded symbols." };
    }

    for (const symbol of allSymbols) {
      if (!fs.existsSync(resolveDatasetCachePath(symbol, "1"))) {
        reply.code(400);
        return { error: "dataset_cache_missing", message: "Dataset cache is missing (required: 1m cache). Run Receive Data again." };
      }
    }

    // count this loop start for each selected history
    incrementDatasetHistoryLoops(datasetHistoryIds, 1);

    let sim: OptimizerSimulationParams;
    let executionModel: "closeOnly" | "conservativeOhlc";
    try {
      sim = parseSimParams(body?.sim);
      executionModel = parseExecutionModel(body?.executionModel);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }
    const datasetModeRaw = body?.datasetMode;
    const datasetMode = datasetModeRaw == null || String(datasetModeRaw).trim() === ""
      ? "snapshot"
      : String(datasetModeRaw);
    if (datasetMode !== "snapshot" && datasetMode !== "followTail") {
      reply.code(400);
      return { error: "invalid_dataset_mode" };
    }
    const payload: OptimizerLoopRunPayload = {
      ...body,
      selectedBotId,
      selectedBotPresetId,
      datasetMode,
      datasetHistoryIds,
      cacheDatasets,
      interval,
      candidates: Number(body?.candidates),
      seed: Number(body?.seed ?? 1),
      directionMode: body?.directionMode == null ? "both" : String(body.directionMode) as "both" | "long" | "short",
      executionModel,
      minTrades: body?.minTrades == null || String(body.minTrades).trim() === "" ? 1 : Math.floor(Number(body.minTrades)),
      excludeNegative: Boolean(body?.excludeNegative),
      rememberNegatives: Boolean(body?.rememberNegatives),
      optTfMin: body?.optTfMin == null || String(body.optTfMin).trim() === "" ? 15 : Math.floor(Number(body.optTfMin)),
      ...(body?.ranges ? { ranges: body.ranges } : {}),
      ...(body?.precision ? { precision: body.precision } : {}),
      sim,
    };
    const optTfMin = Math.floor(Number(payload.optTfMin));
    if (!Number.isInteger(optTfMin) || optTfMin < 5 || optTfMin > 240) {
      reply.code(400);
      return { error: "invalid_opt_tf_min" };
    }
    payload.optTfMin = optTfMin;
    try {
      resolveOptimizerDatasetWindow(payload as unknown as Record<string, unknown>);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_dataset_window", message: String(e?.message ?? e) };
    }
    try {
      const parsedRanges = parseRanges(payload.ranges);
      assertOptimizerMinimumRanges(parsedRanges);
      if (parsedRanges) payload.ranges = parsedRanges;
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }
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
      loopIndex: 0,
      createdAtMs: now,
      updatedAtMs: now,
      finishedAtMs: null,
      lastJobId: null,
      lastError: null,
      runPayload: payload,
    };
    writeLoopState(optimizerLoopState);
    await startLoopJob(app);
    if (!optimizerLoopState.lastJobId) {
      const failedLoopId = optimizerLoopState.loopId;
      updateLoopState({ isRunning: false, isPaused: false });
      reply.code(400);
      return { error: "optimizer_loop_start_failed", message: "Failed to start optimizer loop.", loopId: failedLoopId, ...(optimizerLoopState.lastError ? { lastError: optimizerLoopState.lastError } : {}) };
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
        if (optimizerLoopState?.progress?.jobId === state.lastJobId) {
          const runTotal = state.isInfinite ? Math.max(state.runIndex + 1, 1) : Math.max(1, state.runsCount);
          updateLoopProgressState(buildLoopProgressState(state.lastJobId, "canceled", state.runIndex + 1, runTotal, job.done));
        }
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
      progress: optimizerLoopState.progress ?? null,
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
    const job = resolveOptimizerJob(jobId);
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
    const job = resolveOptimizerJob(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }

    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const requestedPageSize = Math.floor(Number(query.pageSize) || 50);
    const pageSize = [10, 25, 50].includes(requestedPageSize) ? requestedPageSize : 50;
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
    const history = aggregateOptimizerHistorySessions(readOptimizerJobHistory());
    const sorted = history.sort((a, b) => {
      const getValue = (row: OptimizerJobHistoryRecord): number | string => {
        switch (sortKey) {
          case "jobId": return row.jobId;
          case "endedAtMs": return Number(row.endedAtMs) || 0;
          case "status": return row.status;
          case "mode": return row.mode ?? "";
          case "datasets": return Array.isArray(row.runPayload.datasetHistoryIds) ? row.runPayload.datasetHistoryIds.length : 0;
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
    const hasSettings = (row: OptimizerJobHistoryRecord): boolean => {
      if (row.historyType === "session" && Array.isArray(row.childJobIds) && row.childJobIds.length > 0) {
        return row.childJobIds.some((jobId) => Boolean(optimizerJobs.get(jobId)) || Boolean(tryReadOptimizerJobSnapshot(jobId)));
      }
      return Boolean(optimizerJobs.get(row.jobId)) || Boolean(tryReadOptimizerJobSnapshot(row.jobId));
    };
    const filtered = sorted.filter((row) => Number(row.summary?.rowsPositive ?? 0) > 0 && hasSettings(row));
    const items = filtered
      .slice(offset, offset + limit)
      .map((row) => ({ ...row, hasSettings: hasSettings(row) }));
    return { total: filtered.length, items };
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


  app.get("/api/optimizer/jobs/:jobId/trades/export", async (req, reply) => {
    if (!isLocalRequestIp((req as any).ip)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const jobId = String((req.params as any).jobId ?? "").trim();
    const query = (req.query ?? {}) as any;
    const format = String(query.format ?? "json").toLowerCase();
    if (format !== "json") {
      reply.code(400);
      return { error: "invalid_format" };
    }
    const rank = Math.max(1, Math.floor(Number(query.rank) || 0));
    if (!Number.isFinite(rank) || rank < 1) {
      reply.code(400);
      return { error: "invalid_rank" };
    }

    const job = resolveOptimizerJob(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }

    const resolvedRunPayload = withDatasetResolved((job.runPayload as Record<string, unknown>) ?? {});
    const { sorted } = getOptimizerJobResultsSorted(job, query);
    const candidate = sorted[rank - 1];
    if (!candidate) {
      reply.code(404);
      return { error: "optimizer_rank_not_found" };
    }

    const params = candidate.params as OptimizerParams;
    const runArgs = {
      candidates: 1,
      seed: Number((resolvedRunPayload as any)?.seed) || 1,
      ...(candidate.directionMode ? { directionMode: candidate.directionMode } : {}),
      ...(["closeOnly", "conservativeOhlc"].includes(String((resolvedRunPayload as any)?.executionModel))
        ? { executionModel: String((resolvedRunPayload as any)?.executionModel) as "closeOnly" | "conservativeOhlc" }
        : {}),
      optTfMin: Number((resolvedRunPayload as any)?.optTfMin) || 15,
      ...(((resolvedRunPayload as any)?.ranges && typeof (resolvedRunPayload as any).ranges === "object") ? { ranges: (resolvedRunPayload as any).ranges as OptimizerRanges } : {}),
      ...(((resolvedRunPayload as any)?.precision && typeof (resolvedRunPayload as any).precision === "object") ? { precision: (resolvedRunPayload as any).precision as Partial<OptimizerPrecision> } : {}),
      ...(Number.isFinite(Number((resolvedRunPayload as any)?.timeRangeFromTs)) ? { timeRangeFromTs: Number((resolvedRunPayload as any)?.timeRangeFromTs) } : {}),
      ...(Number.isFinite(Number((resolvedRunPayload as any)?.timeRangeToTs)) ? { timeRangeToTs: Number((resolvedRunPayload as any)?.timeRangeToTs) } : {}),
      ...(((resolvedRunPayload as any)?.sim && typeof (resolvedRunPayload as any).sim === "object") ? { sim: (resolvedRunPayload as any).sim as OptimizerSimulationParams } : {}),
      ...(((resolvedRunPayload as any)?.cacheDataset && typeof (resolvedRunPayload as any).cacheDataset === "object") ? { cacheDataset: (resolvedRunPayload as any).cacheDataset as any } : {}),
      ...(Array.isArray((resolvedRunPayload as any)?.cacheDatasets) ? { cacheDatasets: (resolvedRunPayload as any).cacheDatasets as any } : {}),
    };
    const simulation = await simulateCandidateTrades(runArgs, params);

    return {
      jobId,
      rank,
      runPayload: job.runPayload,
      params,
      ...(candidate.directionMode ? { directionMode: candidate.directionMode } : {}),
      trades: simulation.trades,
      summary: {
        netPnl: simulation.stats.netRealized,
        trades: simulation.stats.closedTrades,
        wins: simulation.stats.wins,
        losses: simulation.stats.losses,
        feesPaid: simulation.stats.feesPaid,
        fundingAccrued: simulation.stats.fundingAccrued,
      },
    };
  });

  app.get("/api/optimizer/jobs/:jobId/export", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const query = (req.query ?? {}) as any;
    const format = String(query.format ?? "json").toLowerCase() === "csv" ? "csv" : "json";
    const job = resolveOptimizerJob(jobId);
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
    const job = resolveOptimizerJob(jobId);
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

