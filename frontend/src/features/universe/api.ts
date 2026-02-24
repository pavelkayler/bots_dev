import { getApiBase } from "../../shared/config/env";
import { getJson, postJson } from "../../shared/api/http";
import type { UniverseCreateResponse, UniverseFile, UniversesListResponse } from "./types";

export async function listUniverses(): Promise<UniversesListResponse> {
  const base = getApiBase();
  return await getJson<UniversesListResponse>(`${base}/api/universes`);
}

export async function readUniverse(id: string): Promise<UniverseFile> {
  const base = getApiBase();
  return await getJson<UniverseFile>(`${base}/api/universes/${encodeURIComponent(id)}`);
}

export async function createUniverse(minTurnoverUsd: number, minVolatilityPct: number): Promise<UniverseCreateResponse> {
  const base = getApiBase();
  return await postJson<UniverseCreateResponse>(`${base}/api/universes/create`, { minTurnoverUsd, minVolatilityPct });
}
