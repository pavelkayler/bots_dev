import { getApiBase } from "../../../shared/config/env";
import type { SessionSummaryResponse } from "../types";

export async function fetchSessionSummary(): Promise<SessionSummaryResponse | null> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/session/summary`, { method: "GET" });

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`summary_http_${res.status}${text ? `: ${text}` : ""}`);
  }

  return (await res.json()) as SessionSummaryResponse;
}

export function getSummaryDownloadUrl(): string {
  const base = getApiBase();
  return `${base}/api/session/summary/download`;
}
