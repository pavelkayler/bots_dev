import { getApiBase } from "../../../shared/config/env";
import { getJson } from "../../../shared/api/http";

export type DatasetHistoryRecord = {
  id: string;
  universeId: string;
  universeName: string;
  startMs: number;
  endMs: number;
  interval: string;
  receivedAtMs: number;
  receivedSymbolsCount: number;
  loopsCount: number;
};

export async function listDatasetHistories(): Promise<{ histories: DatasetHistoryRecord[] }> {
  const base = getApiBase();
  return await getJson<{ histories: DatasetHistoryRecord[] }>(`${base}/api/data/history`);
}

export async function deleteDatasetHistory(id: string): Promise<{ ok: true } | { error: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/history/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    try {
      const obj = await res.json();
      return { error: String((obj as any)?.error ?? "delete_failed") };
    } catch {
      return { error: "delete_failed" };
    }
  }
  return (await res.json()) as { ok: true };
}

