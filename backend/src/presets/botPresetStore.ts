import fs from "node:fs";
import path from "node:path";
import { getBotDefinition, DEFAULT_BOT_ID, type BotConfig } from "../bots/registry.js";
import type { RuntimeConfig } from "../runtime/configStore.js";

export type BotPresetMeta = {
  id: string;
  botId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type BotPresetFile = BotPresetMeta & {
  botConfig: BotConfig;
};

const BOT_PRESETS_DIR = path.resolve(process.cwd(), "data", "bot_presets");
const LEGACY_PRESETS_DIR = path.resolve(process.cwd(), "data", "presets");
export const DEFAULT_BOT_PRESET_ID = "default";
export const DEFAULT_BOT_PRESET_NAME = "Default";

function ensureDir() {
  fs.mkdirSync(BOT_PRESETS_DIR, { recursive: true });
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("invalid_bot_preset_id");
  return id;
}

function safeBotId(botId: string): string {
  return getBotDefinition(botId || DEFAULT_BOT_ID).id;
}

function filePathFor(botId: string, id: string): string {
  return path.join(BOT_PRESETS_DIR, `${safeBotId(botId)}__${safeId(id)}.json`);
}

function parsePreset(raw: string): BotPresetFile {
  const parsed = JSON.parse(raw) as Partial<BotPresetFile>;
  if (!parsed?.id || !parsed?.botId || !parsed?.name || !parsed?.botConfig) throw new Error("invalid_bot_preset_file");
  return {
    id: String(parsed.id),
    botId: safeBotId(String(parsed.botId)),
    name: String(parsed.name),
    createdAt: Number(parsed.createdAt) || Date.now(),
    updatedAt: Number(parsed.updatedAt) || Date.now(),
    botConfig: getBotDefinition(String(parsed.botId)).normalizeBotConfig(parsed.botConfig),
  };
}

function toBotConfigFromLegacyRuntimeConfig(config: RuntimeConfig | Record<string, any>, botId: string): BotConfig {
  const c = config as any;
  return getBotDefinition(botId).normalizeBotConfig({
    fundingCooldown: c?.botConfig?.fundingCooldown ?? c?.fundingCooldown,
    signals: c?.botConfig?.signals ?? c?.signals,
    strategy: c?.botConfig?.strategy ?? {
      klineTfMin: c?.universe?.klineTfMin,
      entryOffsetPct: c?.paper?.entryOffsetPct,
      entryTimeoutSec: c?.paper?.entryTimeoutSec,
      tpRoiPct: c?.paper?.tpRoiPct,
      slRoiPct: c?.paper?.slRoiPct,
      rearmDelayMs: c?.paper?.rearmDelayMs,
      applyFunding: c?.paper?.applyFunding,
    },
  });
}

function listLegacyPresets(botId: string): BotPresetMeta[] {
  if (!fs.existsSync(LEGACY_PRESETS_DIR)) return [];
  const files = fs.readdirSync(LEGACY_PRESETS_DIR).filter((f) => f.endsWith(".json"));
  const out: BotPresetMeta[] = [];
  for (const f of files) {
    const full = path.join(LEGACY_PRESETS_DIR, f);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8")) as any;
      if (!parsed?.id || !parsed?.name || !parsed?.config) continue;
      out.push({
        id: String(parsed.id),
        botId,
        name: String(parsed.name),
        createdAt: Number(parsed.createdAt) || Date.now(),
        updatedAt: Number(parsed.updatedAt) || Date.now(),
      });
    } catch {
      continue;
    }
  }
  return out;
}

export function listBotPresets(botId: string): BotPresetMeta[] {
  ensureDir();
  const normalizedBotId = safeBotId(botId);
  const files = fs.readdirSync(BOT_PRESETS_DIR).filter((f) => f.startsWith(`${normalizedBotId}__`) && f.endsWith(".json"));
  const out: BotPresetMeta[] = [];
  for (const f of files) {
    const full = path.join(BOT_PRESETS_DIR, f);
    try {
      const parsed = parsePreset(fs.readFileSync(full, "utf8"));
      out.push({
        id: parsed.id,
        botId: parsed.botId,
        name: parsed.name,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
      });
    } catch {
      continue;
    }
  }
  if (!out.length && normalizedBotId === DEFAULT_BOT_ID) {
    out.push(...listLegacyPresets(normalizedBotId));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function readBotPreset(botId: string, id: string): BotPresetFile {
  ensureDir();
  const normalizedBotId = safeBotId(botId);
  const fp = filePathFor(normalizedBotId, id);
  if (fs.existsSync(fp)) {
    return parsePreset(fs.readFileSync(fp, "utf8"));
  }
  if (normalizedBotId !== DEFAULT_BOT_ID) throw new Error("bot_preset_not_found");
  const legacyPath = path.join(LEGACY_PRESETS_DIR, `${safeId(id)}.json`);
  const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as any;
  return {
    id: String(parsed.id),
    botId: normalizedBotId,
    name: String(parsed.name),
    createdAt: Number(parsed.createdAt) || Date.now(),
    updatedAt: Number(parsed.updatedAt) || Date.now(),
    botConfig: toBotConfigFromLegacyRuntimeConfig(parsed.config, normalizedBotId),
  };
}

export function putBotPreset(botId: string, id: string, name: string, botConfig: BotConfig): BotPresetFile {
  ensureDir();
  const normalizedBotId = safeBotId(botId);
  const now = Date.now();
  let createdAt = now;
  try {
    createdAt = readBotPreset(normalizedBotId, id).createdAt;
  } catch {
    createdAt = now;
  }
  const preset: BotPresetFile = {
    id: safeId(id),
    botId: normalizedBotId,
    name: (name || id).trim(),
    createdAt,
    updatedAt: now,
    botConfig: getBotDefinition(normalizedBotId).normalizeBotConfig(botConfig),
  };
  fs.writeFileSync(filePathFor(normalizedBotId, id), JSON.stringify(preset, null, 2), "utf8");
  return preset;
}

export function ensureDefaultBotPreset(botId: string, botConfig?: BotConfig): BotPresetFile {
  const normalizedBotId = safeBotId(botId);
  try {
    return readBotPreset(normalizedBotId, DEFAULT_BOT_PRESET_ID);
  } catch {
    const fallbackConfig = botConfig ?? getBotDefinition(normalizedBotId).defaults;
    return putBotPreset(normalizedBotId, DEFAULT_BOT_PRESET_ID, DEFAULT_BOT_PRESET_NAME, fallbackConfig);
  }
}

export function deleteBotPreset(botId: string, id: string): void {
  ensureDir();
  if (safeId(id) === DEFAULT_BOT_PRESET_ID) {
    throw new Error("default_bot_preset_cannot_be_deleted");
  }
  fs.rmSync(filePathFor(botId, id), { force: false });
}
