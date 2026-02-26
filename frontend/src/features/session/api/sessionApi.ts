import { getApiBase } from "../../../shared/config/env";
import { getJson, postJson } from "../../../shared/api/http";
import type { StatusResponse } from "../../../shared/types/domain";

export async function fetchStatus(): Promise<StatusResponse> {
  const api = getApiBase();
  return getJson<StatusResponse>(`${api}/api/session/status`);
}

export async function startSession(): Promise<StatusResponse> {
  const api = getApiBase();
  return postJson<StatusResponse>(`${api}/api/session/start`, {});
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
