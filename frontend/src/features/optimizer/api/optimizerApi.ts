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

export async function runOptimization(payload: {
  tapeId: string;
  candidates: number;
  seed: number;
  ranges?: Record<string, number>;
}): Promise<{ tapeId: string; meta: any; results: OptimizationResult[] }> {
  const base = getApiBase();
  return await postJson<{ tapeId: string; meta: any; results: OptimizationResult[] }>(`${base}/api/optimizer/run`, payload);
}
