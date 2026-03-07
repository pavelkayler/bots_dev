import { getJson, postJson } from "../../../shared/api/http";
import { getApiBase } from "../../../shared/config/env";

export type RecorderMode = "off" | "record_only" | "record_while_running";

export type RecorderStatus = {
  state: "idle" | "running" | "waiting" | "error";
  mode: RecorderMode;
  message: string | null;
  writes: number;
  droppedBoundaryPoints: number;
  trackedSymbols: number;
  lastWriteAtMs: number | null;
};

export async function getRecorderStatus(): Promise<RecorderStatus> {
  const base = getApiBase();
  return getJson(`${base}/api/recorder/status`);
}

export async function setRecorderMode(mode: RecorderMode): Promise<{ ok: true; recorder: RecorderStatus }> {
  const base = getApiBase();
  return postJson(`${base}/api/recorder/mode`, { mode });
}
