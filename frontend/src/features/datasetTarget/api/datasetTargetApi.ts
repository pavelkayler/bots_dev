import { getJson, postJson } from "../../../shared/api/http";
import { getApiBase } from "../../../shared/config/env";

export type DatasetRangePreset = "6h" | "12h" | "24h" | "48h" | "1w" | "2w" | "4w" | "1mo";

export type DatasetRange =
  | { kind: "preset"; preset: DatasetRangePreset }
  | { kind: "manual"; startMs: number; endMs: number };

export type BybitKlineInterval = "1" | "3" | "5" | "15" | "30" | "60" | "120" | "240" | "360" | "720" | "D" | "W" | "M";

export type DatasetTarget = {
  universeId: string | null;
  range: DatasetRange;
  interval: BybitKlineInterval;
  updatedAtMs: number;
};

export async function getDatasetTarget(): Promise<{ datasetTarget: DatasetTarget }> {
  const base = getApiBase();
  return await getJson<{ datasetTarget: DatasetTarget }>(`${base}/api/dataset-target`);
}

export async function setDatasetTarget(payload: Partial<DatasetTarget> | any): Promise<{ datasetTarget: DatasetTarget }> {
  const base = getApiBase();
  return await postJson<{ datasetTarget: DatasetTarget }>(`${base}/api/dataset-target`, payload);
}
