import { getApiBase } from "../../shared/config/env";
import { deleteJson, getJson } from "../../shared/api/http";
import type { UniverseCreateResponse, UniverseFile, UniversesListResponse } from "./types";

export async function listUniverses(): Promise<UniversesListResponse> {
  const base = getApiBase();
  return await getJson<UniversesListResponse>(`${base}/api/universes`);
}

export async function readUniverse(id: string): Promise<UniverseFile> {
  const base = getApiBase();
  return await getJson<UniverseFile>(`${base}/api/universes/${encodeURIComponent(id)}`);
}

export async function createUniverse(minTurnoverUsd: number, minVolatilityPct: number, signal?: AbortSignal): Promise<UniverseCreateResponse> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/universes/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minTurnoverUsd, minVolatilityPct }),
    signal,
  });
  if (!res.ok) {
    const bodyText = await res.text();
    let parsed: any = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }
    const detail = parsed?.message ?? parsed?.error ?? bodyText;
    throw new Error(`POST ${base}/api/universes/create failed: ${res.status}${detail ? ` ${String(detail)}` : ""}`);
  }
  return (await res.json()) as UniverseCreateResponse;
}

export async function deleteUniverse(id: string): Promise<{ ok: true }> {
  const base = getApiBase();
  return await deleteJson<{ ok: true }>(`${base}/api/universes/${encodeURIComponent(id)}`);
}
