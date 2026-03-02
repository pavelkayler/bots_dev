import fs from "node:fs";
import path from "node:path";

export type DatasetRangePreset = "24h" | "48h" | "1w" | "2w" | "4w" | "1mo";

export type DatasetRange =
  | { kind: "preset"; preset: DatasetRangePreset }
  | { kind: "manual"; startMs: number; endMs: number };

export type DatasetTarget = {
  universeId: string | null;
  range: DatasetRange;
  updatedAtMs: number;
};

const DATASET_TARGET_PATH = path.resolve(process.cwd(), "data", "dataset_target.json");
const DEFAULT_PRESET: DatasetRangePreset = "24h";
const PRESET_SET = new Set<DatasetRangePreset>(["24h", "48h", "1w", "2w", "4w", "1mo"]);

function defaultTarget(): DatasetTarget {
  return {
    universeId: null,
    range: { kind: "preset", preset: DEFAULT_PRESET },
    updatedAtMs: 0,
  };
}

function normalizeRange(input: unknown): DatasetRange {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  const kind = typeof row?.kind === "string" ? row.kind : "";

  if (!kind) return { kind: "preset", preset: DEFAULT_PRESET };

  if (kind === "preset") {
    const presetRaw = typeof row?.preset === "string" ? row.preset : "";
    const preset = PRESET_SET.has(presetRaw as DatasetRangePreset) ? (presetRaw as DatasetRangePreset) : DEFAULT_PRESET;
    return { kind: "preset", preset };
  }

  if (kind === "manual") {
    const startMsRaw = Number(row?.startMs);
    const endMsRaw = Number(row?.endMs);
    const startMs = Number.isFinite(startMsRaw) ? Math.floor(startMsRaw) : Number.NaN;
    const endMs = Number.isFinite(endMsRaw) ? Math.floor(endMsRaw) : Number.NaN;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      return { kind: "manual", startMs, endMs };
    }
  }

  return { kind: "preset", preset: DEFAULT_PRESET };
}

export function normalizeDatasetTarget(input: unknown): DatasetTarget {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  const universeRaw = typeof row?.universeId === "string" ? row.universeId.trim() : "";
  const universeId = universeRaw ? universeRaw : null;
  const range = normalizeRange(row?.range);

  return {
    universeId,
    range,
    updatedAtMs: Date.now(),
  };
}

export function readDatasetTarget(): DatasetTarget {
  if (!fs.existsSync(DATASET_TARGET_PATH)) return defaultTarget();

  try {
    const raw = fs.readFileSync(DATASET_TARGET_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const row = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const universeRaw = typeof row?.universeId === "string" ? row.universeId.trim() : "";
    const universeId = universeRaw ? universeRaw : null;
    const range = normalizeRange(row?.range);
    const updatedAtRaw = Number(row?.updatedAtMs);
    const updatedAtMs = Number.isFinite(updatedAtRaw) ? Math.floor(updatedAtRaw) : 0;
    return { universeId, range, updatedAtMs };
  } catch {
    return defaultTarget();
  }
}

export function writeDatasetTarget(next: DatasetTarget): DatasetTarget {
  fs.mkdirSync(path.dirname(DATASET_TARGET_PATH), { recursive: true });
  fs.writeFileSync(DATASET_TARGET_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
