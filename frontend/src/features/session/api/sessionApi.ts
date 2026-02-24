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

export function getEventsDownloadUrl(): string {
  const api = getApiBase();
  return `${api}/api/session/events/download`;
}
