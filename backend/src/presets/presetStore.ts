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
  meta: PresetMeta;
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

function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "preset";
}

function filePathForId(id: string): string {
  return path.join(PRESETS_DIR, `${safeId(id)}.json`);
}

export function listPresets(): PresetMeta[] {
  ensureDir();
  const files = fs.readdirSync(PRESETS_DIR).filter((f) => f.endsWith(".json"));

  const out: PresetMeta[] = [];
  for (const f of files) {
    const full = path.join(PRESETS_DIR, f);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const parsed = JSON.parse(raw) as PresetFile;
      if (parsed?.meta?.id) out.push(parsed.meta);
    } catch {
      // ignore invalid files
    }
  }

  out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return out;
}

export function readPreset(id: string): PresetFile {
  ensureDir();
  const fp = filePathForId(id);
  const raw = fs.readFileSync(fp, "utf8");
  const parsed = JSON.parse(raw) as PresetFile;
  if (!parsed?.meta?.id || !parsed?.config) throw new Error("invalid_preset_file");
  return parsed;
}

export function createPreset(name: string, config: RuntimeConfig): PresetFile {
  ensureDir();
  const now = Date.now();
  const id = `${now}_${slugify(name)}`;

  const meta: PresetMeta = {
    id,
    name: name.trim() || "Preset",
    createdAt: now,
    updatedAt: now,
  };

  const preset: PresetFile = { meta, config };
  fs.writeFileSync(filePathForId(id), JSON.stringify(preset, null, 2), "utf8");
  return preset;
}
