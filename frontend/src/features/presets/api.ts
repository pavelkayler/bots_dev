import { getApiBase } from "../../shared/config/env";
import { postJson, getJson } from "../../shared/api/http";
import type { PresetFile, PresetsListResponse } from "./types";
import type { RuntimeConfig } from "../../shared/types/domain";

export async function listPresets(): Promise<PresetsListResponse> {
  const base = getApiBase();
  return await getJson<PresetsListResponse>(`${base}/api/presets`);
}

export async function readPreset(id: string): Promise<PresetFile> {
  const base = getApiBase();
  return await getJson<PresetFile>(`${base}/api/presets/${encodeURIComponent(id)}`);
}

export async function createPreset(name: string, config?: RuntimeConfig): Promise<PresetFile> {
  const base = getApiBase();
  return await postJson<PresetFile>(`${base}/api/presets`, { name, config });
}
