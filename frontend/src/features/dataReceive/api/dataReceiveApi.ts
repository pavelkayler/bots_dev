import { getJson, postJson } from "../../../shared/api/http";
import { getApiBase } from "../../../shared/config/env";

export const DATASET_CACHE_STORAGE_KEY = "bots_dev.datasetCache";

export type ReceiveDataJob = {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: {
    pct: number;
    completedSteps: number;
    totalSteps: number;
    currentSymbol?: string;
    message?: string;
  };
  startedAtMs?: number;
  finishedAtMs?: number;
  error?: { code: string; message: string };
};

export type ReceiveDataStartPayload = {
  universeId: string | null;
  range: { kind: "preset"; preset: string } | { kind: "manual"; startMs: number; endMs: number };
};

export async function startReceiveData(payload?: ReceiveDataStartPayload): Promise<{ jobId: string; datasetCache?: string }> {
  const base = getApiBase();
  return await postJson<{ jobId: string; datasetCache?: string }>(`${base}/api/data/receive`, payload ?? {});
}

export async function getReceiveDataJob(jobId: string): Promise<{ job: ReceiveDataJob; datasetCache?: string }> {
  const base = getApiBase();
  return await getJson<{ job: ReceiveDataJob; datasetCache?: string }>(`${base}/api/data/receive/${encodeURIComponent(jobId)}`);
}

export async function cancelReceiveDataJob(jobId: string): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/data/receive/${encodeURIComponent(jobId)}/cancel`, {});
}
