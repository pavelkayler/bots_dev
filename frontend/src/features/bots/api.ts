import { deleteJson, getJson, postJson, putJson } from "../../shared/api/http";
import { getApiBase } from "../../shared/config/env";
import type { RuntimeConfig } from "../../shared/types/domain";

export type BotMeta = { id: string; name: string };
export type BotPresetMeta = { id: string; botId: string; name: string; updatedAt: number };
export type BotPresetFile = {
  id: string;
  botId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  botConfig: NonNullable<RuntimeConfig["botConfig"]>;
};
export type ExecutionProfileMeta = { id: string; name: string; updatedAt: number };
export type ExecutionProfileFile = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  executionProfile: NonNullable<RuntimeConfig["executionProfile"]>;
};

export async function listBots(): Promise<{ bots: BotMeta[]; selectedBotId: string }> {
  const base = getApiBase();
  return getJson(`${base}/api/bots`);
}

export async function getConfigSelections(): Promise<{ selectedBotId: string; selectedBotPresetId: string; selectedExecutionProfileId: string }> {
  const base = getApiBase();
  return getJson(`${base}/api/config/selections`);
}

export async function saveConfigSelections(payload: Partial<{ selectedBotId: string; selectedBotPresetId: string; selectedExecutionProfileId: string }>) {
  const base = getApiBase();
  return postJson(`${base}/api/config/selections`, payload);
}

export async function listBotPresets(botId: string): Promise<{ presets: BotPresetMeta[] }> {
  const base = getApiBase();
  return getJson(`${base}/api/bot-presets?botId=${encodeURIComponent(botId)}`);
}

export async function readBotPreset(botId: string, id: string): Promise<BotPresetFile> {
  const base = getApiBase();
  return getJson(`${base}/api/bot-presets/${encodeURIComponent(id)}?botId=${encodeURIComponent(botId)}`);
}

export async function saveBotPreset(botId: string, id: string, name: string, botConfig: NonNullable<RuntimeConfig["botConfig"]>): Promise<BotPresetFile> {
  const base = getApiBase();
  return putJson(`${base}/api/bot-presets/${encodeURIComponent(id)}?botId=${encodeURIComponent(botId)}`, { name, botConfig });
}

export async function deleteBotPreset(botId: string, id: string): Promise<void> {
  const base = getApiBase();
  await deleteJson(`${base}/api/bot-presets/${encodeURIComponent(id)}?botId=${encodeURIComponent(botId)}`);
}

export async function listExecutionProfiles(): Promise<{ profiles: ExecutionProfileMeta[] }> {
  const base = getApiBase();
  return getJson(`${base}/api/execution-profiles`);
}

export async function readExecutionProfile(id: string): Promise<ExecutionProfileFile> {
  const base = getApiBase();
  return getJson(`${base}/api/execution-profiles/${encodeURIComponent(id)}`);
}

export async function saveExecutionProfile(id: string, name: string, executionProfile: NonNullable<RuntimeConfig["executionProfile"]>): Promise<ExecutionProfileFile> {
  const base = getApiBase();
  return putJson(`${base}/api/execution-profiles/${encodeURIComponent(id)}`, { name, executionProfile });
}

export async function deleteExecutionProfile(id: string): Promise<void> {
  const base = getApiBase();
  await deleteJson(`${base}/api/execution-profiles/${encodeURIComponent(id)}`);
}
