import fs from "node:fs";
import path from "node:path";
import type { RuntimeConfig } from "../runtime/configStore.js";

export type PresetMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type PresetFile = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: RuntimeConfig;
};

const PRESETS_DIR = path.resolve(process.cwd(), "data", "presets");

function ensureDir() {
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) {
    throw new Error("invalid_preset_id");
  }
  return id;
}

function filePathForId(id: string): string {
  return path.join(PRESETS_DIR, `${safeId(id)}.json`);
}

function parsePreset(raw: string): PresetFile {
  const parsed = JSON.parse(raw) as PresetFile;
  if (!parsed?.id || !parsed?.name || !parsed?.config) throw new Error("invalid_preset_file");
  return parsed;
}

export function listPresets(): PresetMeta[] {
  ensureDir();
  const files = fs.readdirSync(PRESETS_DIR).filter((f) => f.endsWith(".json"));

  const out: PresetMeta[] = [];
  for (const f of files) {
    const full = path.join(PRESETS_DIR, f);
    try {
      const parsed = parsePreset(fs.readFileSync(full, "utf8"));
      out.push({ id: parsed.id, name: parsed.name, createdAt: parsed.createdAt, updatedAt: parsed.updatedAt });
    } catch {
      // ignore invalid files
    }
  }

  out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return out;
}

export function readPreset(id: string): PresetFile {
  ensureDir();
  return parsePreset(fs.readFileSync(filePathForId(id), "utf8"));
}

export function putPreset(id: string, name: string, config: RuntimeConfig): PresetFile {
  ensureDir();
  const now = Date.now();
  let createdAt = now;
  try {
    createdAt = readPreset(id).createdAt ?? now;
  } catch {
    createdAt = now;
  }

  const preset: PresetFile = {
    id: safeId(id),
    name: (name || id).trim(),
    createdAt,
    updatedAt: now,
    config,
  };
  fs.writeFileSync(filePathForId(id), JSON.stringify(preset, null, 2), "utf8");
  return preset;
}

export function deletePreset(id: string): void {
  const fp = filePathForId(id);
  fs.rmSync(fp, { force: false });
}
