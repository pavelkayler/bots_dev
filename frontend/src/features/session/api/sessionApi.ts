import { getApiBase } from "../../../shared/config/env";
import { getJson, postJson } from "../../../shared/api/http";
import type { DemoSummaryResponse, StatusResponse } from "../../../shared/types/domain";

export async function fetchStatus(): Promise<StatusResponse> {
  const api = getApiBase();
  return getJson<StatusResponse>(`${api}/api/session/status`);
}

export async function startSession(payload?: Partial<{ selectedBotId: string; selectedBotPresetId: string; selectedExecutionProfileId: string }>): Promise<StatusResponse> {
  const api = getApiBase();
  return postJson<StatusResponse>(`${api}/api/session/start`, payload ?? {});
}

export async function stopSession(): Promise<StatusResponse> {
  const api = getApiBase();
  return postJson<StatusResponse>(`${api}/api/session/stop`, {});
}

export async function pauseSession(): Promise<StatusResponse> {
  const api = getApiBase();
  return postJson<StatusResponse>(`${api}/api/session/pause`, {});
}

export async function resumeSession(): Promise<StatusResponse> {
  const api = getApiBase();
  return postJson<StatusResponse>(`${api}/api/session/resume`, {});
}

export function getEventsDownloadUrl(): string {
  const api = getApiBase();
  return `${api}/api/session/events/download`;
}

export function getRunPackManifestUrl(): string {
  const api = getApiBase();
  return `${api}/api/session/run-pack`;
}

export function getRunPackConfigUrl(): string {
  const api = getApiBase();
  return `${api}/api/session/run-pack/config/download`;
}

export function getRunPackUniverseUrl(): string {
  const api = getApiBase();
  return `${api}/api/session/run-pack/universe/download`;
}

export async function fetchDemoSummary(): Promise<DemoSummaryResponse | null> {
  const api = getApiBase();
  const res = await fetch(`${api}/api/session/demo-summary`, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`demo_summary_http_${res.status}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as DemoSummaryResponse;
}

export function getDemoSummaryDownloadUrl(): string {
  const api = getApiBase();
  return `${api}/api/session/demo-summary/download`;
}
