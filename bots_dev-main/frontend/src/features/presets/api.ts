import { deleteJson, getJson, putJson } from "../../shared/api/http";
import { getApiBase } from "../../shared/config/env";
import type { RuntimeConfig } from "../../shared/types/domain";
import type { PresetFile, PresetsListResponse } from "./types";

export async function listPresets(): Promise<PresetsListResponse> {
  const base = getApiBase();
  return await getJson<PresetsListResponse>(`${base}/api/presets`);
}

export async function readPreset(id: string): Promise<PresetFile> {
  const base = getApiBase();
  return await getJson<PresetFile>(`${base}/api/presets/${encodeURIComponent(id)}`);
}

export async function savePreset(id: string, name: string, config: RuntimeConfig): Promise<PresetFile> {
  const base = getApiBase();
  return await putJson<PresetFile>(`${base}/api/presets/${encodeURIComponent(id)}`, { name, config });
}

export async function deletePreset(id: string): Promise<void> {
  const base = getApiBase();
  await deleteJson<void>(`${base}/api/presets/${encodeURIComponent(id)}`);
}
