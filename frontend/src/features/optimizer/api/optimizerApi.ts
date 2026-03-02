import { getApiBase } from "../../../shared/config/env";
import { getJson, postJson } from "../../../shared/api/http";

export type OptimizerTape = {
  id: string;
  createdAt: number;
  fileSizeBytes: number;
  runsTotal: number;
  startTs: number | null;
  endTs: number | null;
  meta: {
    tapeId?: string;
    createdAt?: number;
    sessionId?: string | null;
    universeSelectedId?: string;
    klineTfMin?: number;
    symbols?: string[];
  } | null;
};

export type OptimizationResult = {
  rank: number;
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
  params: {
    priceThresholdPct: number;
    oivThresholdPct: number;
    entryOffsetPct: number;
    tpRoiPct: number;
    slRoiPct: number;
    timeoutSec: number;
    rearmMs: number;
  };
};


export type OptimizerLoopStatus = {
  loop: {
    loopId: string;
    isRunning: boolean;
    isPaused: boolean;
    isInfinite: boolean;
    runsCount: number;
    runIndex: number;
    createdAtMs: number;
    updatedAtMs: number;
    finishedAtMs?: number | null;
    lastJobId: string | null;
    runPayload: Record<string, unknown>;
  } | null;
  runsCompleted?: number;
  runsTotal?: number | null;
  lastJobStatus?: { status: "running" | "paused" | "done" | "error" | "cancelled"; donePercent: number; message?: string } | null;
};
export type OptimizerSortKey = "netPnl" | "trades" | "winRatePct";
export type OptimizerSortDir = "asc" | "desc";
export type OptimizerHistorySortKey =
  | "jobId"
  | "endedAtMs"
  | "status"
  | "mode"
  | "tapes"
  | "tfMin"
  | "candidates"
  | "seed"
  | "minTrades"
  | "direction"
  | "rememberNegatives"
  | "hideNegativeNetPnl"
  | "bestNetPnl"
  | "bestTrades"
  | "bestWinRate"
  | "bestProfitFactor"
  | "bestMaxDD"
  | "rowsPositive"
  | "rowsTotal";
export type OptimizerPrecision = Record<"priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs", number>;
export type OptimizerSettings = { tapesDir: string };
export type OptimizerSimulationParams = {
  initialBalance?: number;
  marginPerTrade?: number;
  leverage?: number;
  feeBps?: number;
  fundingBpsPer8h?: number;
  slippageBps?: number;
};

export type DoctorStatus = {
  ok: boolean;
  nowMs: number;
  ports: { http: number };
  disk: { dataDir: string; freeBytes: number | null };
  dataDirBytesFree: number | null;
  paths: { tapesDir: string; checkpointsDir: string; blacklistsDir: string };
  warnings: string[];
};

export type SoakLastStatus = {
  snapshot: null | {
    tsMs: number;
    state: string;
    memory: { rss: number; heapUsed: number; heapTotal: number };
    dataDirFreeBytes: number | null;
  };
};

export type OptimizerJobHistoryRecord = {
  jobId: string;
  mode?: "loop" | "single";
  endedAtMs: number;
  status: "done" | "cancelled" | "stopped" | "error";
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

export type OptimizerSortKeyExtended =
  | OptimizerSortKey
  | "priceTh"
  | "oivTh"
  | "tp"
  | "sl"
  | "offset"
  | "timeoutSec"
  | "rearmMs"
  | "expectancy"
  | "profitFactor"
  | "maxDrawdownUsdt"
  | "ordersPlaced"
  | "ordersFilled"
  | "ordersExpired";


export type OptimizerHistoryExport = {
  exportedAtMs: number;
  runs: unknown[];
  loopState?: unknown;
};

export async function listTapes(): Promise<{ tapes: OptimizerTape[] }> {
  const base = getApiBase();
  return await getJson<{ tapes: OptimizerTape[] }>(`${base}/api/optimizer/tapes`);
}

export async function getSettings(): Promise<OptimizerSettings> {
  const base = getApiBase();
  return await getJson<OptimizerSettings>(`${base}/api/optimizer/settings`);
}

export async function setSettings(payload: OptimizerSettings): Promise<OptimizerSettings> {
  const base = getApiBase();
  return await postJson<OptimizerSettings>(`${base}/api/optimizer/settings`, payload);
}

export async function startTape(): Promise<{ tapeId: string }> {
  const base = getApiBase();
  return await postJson<{ tapeId: string }>(`${base}/api/optimizer/tapes/start`, {});
}

export async function stopTape(): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/optimizer/tapes/stop`, {});
}

export async function getStatus(): Promise<{ isRecording: boolean; tapeId: string | null; dataSource: "tapes" }> {
  const base = getApiBase();
  return await getJson<{ isRecording: boolean; tapeId: string | null; dataSource: "tapes" }>(`${base}/api/optimizer/status`);
}

export async function runOptimizationJob(payload: {
  tapeId?: string;
  tapeIds?: string[];
  datasetMode?: "snapshot" | "followTail";
  timeRangeFromTs?: number | null;
  timeRangeToTs?: number | null;
  candidates: number;
  seed: number;
  minTrades?: number;
  ranges?: Partial<Record<"priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs", { min: number; max: number }>>;
  precision?: Partial<OptimizerPrecision>;
  directionMode?: "both" | "long" | "short";
  optTfMin?: number;
  excludeNegative?: boolean;
  rememberNegatives?: boolean;
  sim?: OptimizerSimulationParams;
}): Promise<{ jobId: string }> {
  const base = getApiBase();
  return await postJson<{ jobId: string }>(`${base}/api/optimizer/run`, payload);
}

export async function getJobStatus(jobId: string): Promise<{ status: "running" | "paused" | "done" | "error" | "cancelled"; total: number; done: number; startedAtMs?: number; updatedAtMs?: number; finishedAtMs?: number | null; message?: string }> {
  const base = getApiBase();
  return await getJson<{ status: "running" | "paused" | "done" | "error" | "cancelled"; total: number; done: number; startedAtMs?: number; updatedAtMs?: number; finishedAtMs?: number | null; message?: string }>(`${base}/api/optimizer/jobs/${encodeURIComponent(jobId)}/status`);
}

export async function getCurrentJob(): Promise<{ jobId: string | null }> {
  const base = getApiBase();
  return await getJson<{ jobId: string | null }>(`${base}/api/optimizer/jobs/current`);
}

export async function getJobResults(
  jobId: string,
  query: { page: number; sortKey: OptimizerSortKeyExtended; sortDir: OptimizerSortDir; positiveOnly?: boolean }
): Promise<{
  status: "running" | "paused" | "done" | "error" | "cancelled";
  page: number;
  pageSize: number;
  totalRows: number;
  sortKey: OptimizerSortKeyExtended;
  sortDir: OptimizerSortDir;
  results: OptimizationResult[];
}> {
  const base = getApiBase();
  const params = new URLSearchParams({
    page: String(query.page),
    sortKey: query.sortKey,
    sortDir: query.sortDir,
  });
  if (query.positiveOnly) params.set("positiveOnly", "1");
  return await getJson(`${base}/api/optimizer/jobs/${encodeURIComponent(jobId)}/results?${params.toString()}`);
}

export async function getOptimizerJobHistory(query?: {
  limit?: 10 | 25 | 50 | 100;
  offset?: number;
  sortKey?: OptimizerHistorySortKey;
  sortDir?: OptimizerSortDir;
}): Promise<{ total: number; items: OptimizerJobHistoryRecord[] }> {
  const base = getApiBase();
  const params = new URLSearchParams();
  if (query?.limit != null) params.set("limit", String(query.limit));
  if (query?.offset != null) params.set("offset", String(query.offset));
  if (query?.sortKey) params.set("sortKey", query.sortKey);
  if (query?.sortDir) params.set("sortDir", query.sortDir);
  return await getJson<{ total: number; items: OptimizerJobHistoryRecord[] }>(`${base}/api/optimizer/jobs/history?${params.toString()}`);
}

export function getJobExportUrl(jobId: string, format: "json" | "csv" = "json", sortKey?: OptimizerSortKeyExtended, sortDir?: OptimizerSortDir): string {
  const base = getApiBase();
  const params = new URLSearchParams();
  params.set("format", format);
  if (sortKey) params.set("sortKey", sortKey);
  if (sortDir) params.set("sortDir", sortDir);
  return `${base}/api/optimizer/jobs/${encodeURIComponent(jobId)}/export?${params.toString()}`;
}

export function getCurrentJobExportUrl(format: "json" | "csv" = "json", sortKey?: OptimizerSortKeyExtended, sortDir?: OptimizerSortDir): string {
  const base = getApiBase();
  const params = new URLSearchParams();
  params.set("format", format);
  if (sortKey) params.set("sortKey", sortKey);
  if (sortDir) params.set("sortDir", sortDir);
  return `${base}/api/optimizer/jobs/current/export?${params.toString()}`;
}

export async function cancelCurrentJob(): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/optimizer/jobs/current/cancel`, {});
}

export async function pauseCurrentJob(): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/optimizer/jobs/current/pause`, {});
}

export async function resumeCurrentJob(): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/optimizer/jobs/current/resume`, {});
}


export async function startOptimizerLoop(payload: {
  tapeId?: string;
  tapeIds?: string[];
  datasetMode?: "snapshot" | "followTail";
  timeRangeFromTs?: number | null;
  timeRangeToTs?: number | null;
  candidates: number;
  seed: number;
  minTrades?: number;
  ranges?: Partial<Record<"priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs", { min: number; max: number }>>;
  precision?: Partial<OptimizerPrecision>;
  directionMode?: "both" | "long" | "short";
  optTfMin?: number;
  excludeNegative?: boolean;
  rememberNegatives?: boolean;
  runsCount?: number;
  infinite?: boolean;
  sim?: OptimizerSimulationParams;
}): Promise<{ loopId: string }> {
  const base = getApiBase();
  return await postJson<{ loopId: string }>(`${base}/api/optimizer/loop/start`, payload);
}

export async function stopOptimizerLoop(): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/optimizer/loop/stop`, {});
}

export async function pauseOptimizerLoop(): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/optimizer/loop/pause`, {});
}

export async function resumeOptimizerLoop(): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/optimizer/loop/resume`, {});
}

export async function getOptimizerLoopStatus(): Promise<OptimizerLoopStatus> {
  const base = getApiBase();
  return await getJson<OptimizerLoopStatus>(`${base}/api/optimizer/loop/status`);
}

export async function getDoctorStatus(): Promise<DoctorStatus> {
  const base = getApiBase();
  return await getJson<DoctorStatus>(`${base}/api/doctor`);
}

export async function getLastSoakSnapshot(): Promise<SoakLastStatus> {
  const base = getApiBase();
  return await getJson<SoakLastStatus>(`${base}/api/soak/last`);
}


export async function exportOptimizerHistory(): Promise<OptimizerHistoryExport> {
  const base = getApiBase();
  return await getJson<OptimizerHistoryExport>(`${base}/api/optimizer/history/export`);
}

export async function importOptimizerHistory(payload: { runs: unknown[]; mode?: "merge" | "replace" }): Promise<{ ok: true; imported: number; total: number; mode: "merge" | "replace" }> {
  const base = getApiBase();
  return await postJson<{ ok: true; imported: number; total: number; mode: "merge" | "replace" }>(`${base}/api/optimizer/history/import`, payload);
}
