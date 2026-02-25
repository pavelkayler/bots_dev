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
  params: {
    priceThresholdPct: number;
    oivThresholdPct: number;
    entryOffsetPct: number;
    tpRoiPct: number;
    slRoiPct: number;
  };
};

export type OptimizerSortKey = "netPnl" | "trades" | "winRatePct";
export type OptimizerSortDir = "asc" | "desc";

export async function listTapes(): Promise<{ tapes: OptimizerTape[] }> {
  const base = getApiBase();
  return await getJson<{ tapes: OptimizerTape[] }>(`${base}/api/optimizer/tapes`);
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
  ranges?: Partial<Record<"priceTh" | "oivTh" | "tp" | "sl" | "offset", { min: number; max: number }>>;
}): Promise<{ jobId: string }> {
  const base = getApiBase();
  return await postJson<{ jobId: string }>(`${base}/api/optimizer/run`, payload);
}

export async function getJobStatus(jobId: string): Promise<{ status: "running" | "done" | "error"; total: number; done: number; message?: string }> {
  const base = getApiBase();
  return await getJson<{ status: "running" | "done" | "error"; total: number; done: number; message?: string }>(`${base}/api/optimizer/jobs/${encodeURIComponent(jobId)}/status`);
}

export async function getCurrentJob(): Promise<{ jobId: string | null }> {
  const base = getApiBase();
  return await getJson<{ jobId: string | null }>(`${base}/api/optimizer/jobs/current`);
}

export async function getJobResults(
  jobId: string,
  query: { page: number; sortKey: OptimizerSortKey; sortDir: OptimizerSortDir }
): Promise<{
  status: "running" | "done" | "error";
  page: number;
  pageSize: number;
  totalRows: number;
  sortKey: OptimizerSortKey;
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
