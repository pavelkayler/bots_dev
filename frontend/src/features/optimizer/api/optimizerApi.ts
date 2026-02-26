import { getApiBase } from "../../../shared/config/env";
import { getJson, postJson } from "../../../shared/api/http";

export type OptimizerTape = {
  id: string;
  createdAt: number;
  fileSizeBytes: number;
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

export type OptimizerSortKey = "netPnl" | "trades" | "winRatePct";
export type OptimizerSortDir = "asc" | "desc";
export type OptimizerPrecision = Record<"priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs", number>;
export type OptimizerSettings = { tapesDir: string };

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

export async function getStatus(): Promise<{ isRecording: boolean; tapeId: string | null }> {
  const base = getApiBase();
  return await getJson<{ isRecording: boolean; tapeId: string | null }>(`${base}/api/optimizer/status`);
}

export async function runOptimizationJob(payload: {
  tapeId?: string;
  tapeIds?: string[];
  candidates: number;
  seed: number;
  minTrades?: number;
  ranges?: Partial<Record<"priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs", { min: number; max: number }>>;
  precision?: Partial<OptimizerPrecision>;
  directionMode?: "both" | "long" | "short";
  optTfMin?: number;
  excludeNegative?: boolean;
}): Promise<{ jobId: string }> {
  const base = getApiBase();
  return await postJson<{ jobId: string }>(`${base}/api/optimizer/run`, payload);
}

export async function getJobStatus(jobId: string): Promise<{ status: "running" | "paused" | "done" | "error" | "cancelled"; total: number; done: number; startedAtMs?: number; updatedAtMs?: number; message?: string }> {
  const base = getApiBase();
  return await getJson<{ status: "running" | "paused" | "done" | "error" | "cancelled"; total: number; done: number; startedAtMs?: number; updatedAtMs?: number; message?: string }>(`${base}/api/optimizer/jobs/${encodeURIComponent(jobId)}/status`);
}

export async function getCurrentJob(): Promise<{ jobId: string | null }> {
  const base = getApiBase();
  return await getJson<{ jobId: string | null }>(`${base}/api/optimizer/jobs/current`);
}

export async function getJobResults(
  jobId: string,
  query: { page: number; sortKey: OptimizerSortKeyExtended; sortDir: OptimizerSortDir }
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
  return await getJson(`${base}/api/optimizer/jobs/${encodeURIComponent(jobId)}/results?${params.toString()}`);
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
