import fs from "node:fs";
import path from "node:path";
import type { ExecutionProfile, RuntimeConfig } from "../runtime/configStore.js";
import { CONFIG } from "../config.js";

export type ExecutionProfileMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type ExecutionProfileFile = ExecutionProfileMeta & {
  executionProfile: ExecutionProfile;
};

const EXECUTION_PROFILES_DIR = path.resolve(process.cwd(), "data", "execution_profiles");
const LEGACY_PRESETS_DIR = path.resolve(process.cwd(), "data", "presets");
const DEFAULT_EXECUTION_PROFILE_ID = "default";
const DEFAULT_EXECUTION_PROFILE_NAME = "Default";

function ensureDir() {
  fs.mkdirSync(EXECUTION_PROFILES_DIR, { recursive: true });
}

function buildDefaultExecutionProfile(): ExecutionProfile {
  return {
    execution: { mode: "paper" },
    paper: {
      enabled: CONFIG.paper.enabled,
      directionMode: CONFIG.paper.directionMode,
      marginUSDT: CONFIG.paper.marginUSDT,
      leverage: CONFIG.paper.leverage,
      makerFeeRate: CONFIG.paper.makerFeeRate,
      maxDailyLossUSDT: CONFIG.paper.maxDailyLossUSDT,
    },
    riskLimits: {
      maxTradesPerDay: CONFIG.riskLimits.maxTradesPerDay,
      maxLossPerDayUsdt: CONFIG.riskLimits.maxLossPerDayUsdt,
      maxLossPerSessionUsdt: CONFIG.riskLimits.maxLossPerSessionUsdt,
      maxConsecutiveErrors: CONFIG.riskLimits.maxConsecutiveErrors,
    },
  };
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("invalid_execution_profile_id");
  return id;
}

function filePathFor(id: string): string {
  return path.join(EXECUTION_PROFILES_DIR, `${safeId(id)}.json`);
}

function ensureDefaultExecutionProfileFile() {
  ensureDir();
  const files = fs.readdirSync(EXECUTION_PROFILES_DIR).filter((f) => f.endsWith(".json"));
  if (files.length > 0) return;
  const now = Date.now();
  const next: ExecutionProfileFile = {
    id: DEFAULT_EXECUTION_PROFILE_ID,
    name: DEFAULT_EXECUTION_PROFILE_NAME,
    createdAt: now,
    updatedAt: now,
    executionProfile: buildDefaultExecutionProfile(),
  };
  fs.writeFileSync(filePathFor(DEFAULT_EXECUTION_PROFILE_ID), JSON.stringify(next, null, 2), "utf8");
}

function parseExecutionProfile(raw: string): ExecutionProfileFile {
  const parsed = JSON.parse(raw) as Partial<ExecutionProfileFile>;
  if (!parsed?.id || !parsed?.name || !parsed?.executionProfile) throw new Error("invalid_execution_profile_file");
  return {
    id: String(parsed.id),
    name: String(parsed.name),
    createdAt: Number(parsed.createdAt) || Date.now(),
    updatedAt: Number(parsed.updatedAt) || Date.now(),
    executionProfile: parsed.executionProfile as ExecutionProfile,
  };
}

function toExecutionProfileFromLegacyRuntimeConfig(config: RuntimeConfig | Record<string, any>): ExecutionProfile {
  const c = config as any;
  return {
    execution: c?.executionProfile?.execution ?? c?.execution ?? { mode: "paper" },
    paper: c?.executionProfile?.paper ?? {
      enabled: c?.paper?.enabled ?? true,
      directionMode: c?.paper?.directionMode ?? "both",
      marginUSDT: c?.paper?.marginUSDT ?? 10,
      leverage: c?.paper?.leverage ?? 5,
      makerFeeRate: c?.paper?.makerFeeRate ?? 0.0002,
      maxDailyLossUSDT: c?.paper?.maxDailyLossUSDT ?? 0,
    },
    riskLimits: c?.executionProfile?.riskLimits ?? c?.riskLimits ?? {
      maxTradesPerDay: 2,
      maxLossPerDayUsdt: null,
      maxLossPerSessionUsdt: null,
      maxConsecutiveErrors: 10,
    },
  };
}

export function listExecutionProfiles(): ExecutionProfileMeta[] {
  ensureDefaultExecutionProfileFile();
  const files = fs.readdirSync(EXECUTION_PROFILES_DIR).filter((f) => f.endsWith(".json"));
  const out: ExecutionProfileMeta[] = [];
  for (const f of files) {
    const full = path.join(EXECUTION_PROFILES_DIR, f);
    try {
      const parsed = parseExecutionProfile(fs.readFileSync(full, "utf8"));
      out.push({ id: parsed.id, name: parsed.name, createdAt: parsed.createdAt, updatedAt: parsed.updatedAt });
    } catch {
      continue;
    }
  }
  if (!out.length && fs.existsSync(LEGACY_PRESETS_DIR)) {
    for (const f of fs.readdirSync(LEGACY_PRESETS_DIR).filter((name) => name.endsWith(".json"))) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(LEGACY_PRESETS_DIR, f), "utf8")) as any;
        if (!parsed?.id || !parsed?.name || !parsed?.config) continue;
        out.push({
          id: String(parsed.id),
          name: String(parsed.name),
          createdAt: Number(parsed.createdAt) || Date.now(),
          updatedAt: Number(parsed.updatedAt) || Date.now(),
        });
      } catch {
        continue;
      }
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function readExecutionProfile(id: string): ExecutionProfileFile {
  ensureDefaultExecutionProfileFile();
  const fp = filePathFor(id);
  if (fs.existsSync(fp)) return parseExecutionProfile(fs.readFileSync(fp, "utf8"));
  const legacyPath = path.join(LEGACY_PRESETS_DIR, `${safeId(id)}.json`);
  const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as any;
  return {
    id: String(parsed.id),
    name: String(parsed.name),
    createdAt: Number(parsed.createdAt) || Date.now(),
    updatedAt: Number(parsed.updatedAt) || Date.now(),
    executionProfile: toExecutionProfileFromLegacyRuntimeConfig(parsed.config),
  };
}

export function putExecutionProfile(id: string, name: string, executionProfile: ExecutionProfile): ExecutionProfileFile {
  ensureDir();
  const now = Date.now();
  let createdAt = now;
  try {
    createdAt = readExecutionProfile(id).createdAt;
  } catch {
    createdAt = now;
  }
  const next: ExecutionProfileFile = {
    id: safeId(id),
    name: (name || id).trim(),
    createdAt,
    updatedAt: now,
    executionProfile,
  };
  fs.writeFileSync(filePathFor(id), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function deleteExecutionProfile(id: string): void {
  ensureDir();
  fs.rmSync(filePathFor(id), { force: false });
}
