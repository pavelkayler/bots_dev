import { getJson, postJson } from "../../../shared/api/http";
import { getApiBase } from "../../../shared/config/env";

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

export async function startReceiveData(): Promise<{ jobId: string }> {
  const base = getApiBase();
  return await postJson<{ jobId: string }>(`${base}/api/data/receive`, {});
}

export async function getReceiveDataJob(jobId: string): Promise<{ job: ReceiveDataJob }> {
  const base = getApiBase();
  return await getJson<{ job: ReceiveDataJob }>(`${base}/api/data/receive/${encodeURIComponent(jobId)}`);
}

export async function cancelReceiveDataJob(jobId: string): Promise<{ ok: true }> {
  const base = getApiBase();
  return await postJson<{ ok: true }>(`${base}/api/data/receive/${encodeURIComponent(jobId)}/cancel`, {});
}
