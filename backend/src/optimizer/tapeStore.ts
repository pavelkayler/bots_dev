import fs from "node:fs";
import path from "node:path";
import { getTapeRunsTotals } from "./tapeRunsStore.js";

const OPTIMIZER_SETTINGS_PATH = path.resolve(process.cwd(), "data", "optimizer_settings.json");
const DEFAULT_TAPES_DIR = path.resolve(process.cwd(), "data", "tapes");

type OptimizerSettings = {
  tapesDir: string;
};

export type TapeMetaLine = {
  tapeId?: string;
  createdAt?: number;
  sessionId?: string | null;
  universeSelectedId?: string;
  klineTfMin?: number;
  symbols?: string[];
};

export type TapeListItem = {
  id: string;
  createdAt: number;
  fileSizeBytes: number;
  meta: TapeMetaLine | null;
  runsTotal: number;
};

function readSettingsFile(): OptimizerSettings | null {
  if (!fs.existsSync(OPTIMIZER_SETTINGS_PATH)) return null;
  try {
    const raw = fs.readFileSync(OPTIMIZER_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OptimizerSettings>;
    if (typeof parsed.tapesDir === "string" && parsed.tapesDir.trim()) {
      return { tapesDir: parsed.tapesDir };
    }
  } catch {
    return null;
  }
  return null;
}

function writeSettingsFile(settings: OptimizerSettings) {
  fs.mkdirSync(path.dirname(OPTIMIZER_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(OPTIMIZER_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function normalizeTapesDir(tapesDir: string): string {
  const text = String(tapesDir ?? "").trim();
  if (!text) throw new Error("invalid_tapes_dir");
  return path.resolve(text);
}

export function getOptimizerSettings(): OptimizerSettings {
  const fromFile = readSettingsFile();
  if (fromFile) return fromFile;
  return { tapesDir: DEFAULT_TAPES_DIR };
}

export function setOptimizerSettings(input: { tapesDir: string }): OptimizerSettings {
  const tapesDir = normalizeTapesDir(input.tapesDir);
  fs.mkdirSync(tapesDir, { recursive: true });
  const next = { tapesDir };
  writeSettingsFile(next);
  return next;
}

export function getTapesDir(): string {
  return getOptimizerSettings().tapesDir;
}

export function ensureDir() {
  fs.mkdirSync(getTapesDir(), { recursive: true });
}

export function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) {
    throw new Error("invalid_tape_id");
  }
  return id;
}

export function getTapePath(id: string): string {
  return path.join(getTapesDir(), `${safeId(id)}.jsonl`);
}

export function listTapeSegments(baseTapeId: string): string[] {
  const safeBaseId = safeId(baseTapeId);
  const escapedBaseId = safeBaseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  ensureDir();
  const tapesDir = getTapesDir();
  const files = fs.readdirSync(tapesDir).filter((file) => file.endsWith(".jsonl"));
  const ids = files.map((file) => file.slice(0, -".jsonl".length));
  const segmentIds = ids
    .map((id) => {
      if (id === safeBaseId) return { id, seg: 1 };
      const match = id.match(new RegExp(`^${escapedBaseId}-seg(\\d+)$`));
      if (!match) return null;
      const seg = Number(match[1]);
      if (!Number.isFinite(seg) || seg < 2) return null;
      return { id, seg: Math.floor(seg) };
    })
    .filter((value): value is { id: string; seg: number } => Boolean(value));

  return segmentIds.sort((a, b) => a.seg - b.seg).map((row) => row.id);
}

export function getTapeSizeBytes(tapeId: string): number {
  return fs.statSync(getTapePath(tapeId)).size;
}

export function resolveTapePath(id: string): string {
  const tapePath = getTapePath(id);
  const realTapesDir = fs.realpathSync.native(getTapesDir());
  const resolvedPath = path.resolve(tapePath);
  const parentDir = path.dirname(resolvedPath);
  const realParentDir = fs.existsSync(parentDir) ? fs.realpathSync.native(parentDir) : path.resolve(parentDir);
  if (realParentDir !== realTapesDir) {
    throw new Error("invalid_tape_path");
  }
  return resolvedPath;
}

export function listTapes(): TapeListItem[] {
  ensureDir();
  const tapesDir = getTapesDir();
  const runsTotals = getTapeRunsTotals();
  const files = fs.readdirSync(tapesDir).filter((file) => file.endsWith(".jsonl"));

  const tapes: TapeListItem[] = [];

  for (const file of files) {
    const id = file.slice(0, -".jsonl".length);
    const fullPath = path.join(tapesDir, file);

    try {
      const stat = fs.statSync(fullPath);
      let meta: TapeMetaLine | null = null;

      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const firstLine = raw.split(/\r?\n/, 1)[0]?.trim();
        if (firstLine) {
          const parsed = JSON.parse(firstLine) as { type?: string; payload?: unknown };
          if (parsed?.type === "meta" && parsed.payload && typeof parsed.payload === "object") {
            meta = parsed.payload as TapeMetaLine;
          }
        }
      } catch {
        meta = null;
      }

      const createdAt = Number(meta?.createdAt);
      tapes.push({
        id,
        createdAt: Number.isFinite(createdAt) ? createdAt : stat.mtimeMs,
        fileSizeBytes: stat.size,
        meta,
        runsTotal: runsTotals[id] ?? 0,
      });
    } catch {
      // ignore
    }
  }

  tapes.sort((a, b) => b.createdAt - a.createdAt);
  return tapes;
}
