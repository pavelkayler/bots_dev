import fs from "node:fs";
import path from "node:path";

export type UniverseMeta = {
  id: string;
  name: string;

  minTurnoverUsd: number;
  minVolatilityPct: number;
  metricsRange?: "24h" | "48h" | "1w" | "2w" | "1mo";

  createdAt: number;
  updatedAt: number;

  count: number;
};

export type UniverseFile = {
  meta: UniverseMeta;
  symbols: string[];
};

const UNIVERSES_DIR = path.resolve(process.cwd(), "data", "universes");

function ensureDir() {
  fs.mkdirSync(UNIVERSES_DIR, { recursive: true });
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("invalid_universe_id");
  return id;
}

function filePathForId(id: string): string {
  ensureDir();
  return path.join(UNIVERSES_DIR, `${safeId(id)}.json`);
}

export function listUniverses(): UniverseMeta[] {
  ensureDir();
  const files = fs.readdirSync(UNIVERSES_DIR).filter((f) => f.endsWith(".json"));

  const out: UniverseMeta[] = [];
  for (const f of files) {
    const full = path.join(UNIVERSES_DIR, f);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const parsed = JSON.parse(raw) as UniverseFile;
      if (parsed?.meta?.id) out.push(parsed.meta);
    } catch {
      // ignore
    }
  }

  out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return out;
}

export function readUniverse(id: string): UniverseFile {
  const fp = filePathForId(id);
  const raw = fs.readFileSync(fp, "utf8");
  const parsed = JSON.parse(raw) as UniverseFile;
  if (!parsed?.meta?.id || !Array.isArray(parsed.symbols)) throw new Error("invalid_universe_file");
  return parsed;
}

export function writeUniverse(file: UniverseFile): UniverseFile {
  const fp = filePathForId(file.meta.id);
  fs.writeFileSync(fp, JSON.stringify(file, null, 2), "utf8");
  return file;
}

export function deleteUniverse(id: string): void {
  const fp = filePathForId(id);
  if (!fs.existsSync(fp)) throw new Error("universe_not_found");
  fs.unlinkSync(fp);
}

export function formatUniverseName(
  minTurnoverUsd: number,
  minVolatilityPct: number,
  metricsRange: "24h" | "48h" | "1w" | "2w" | "1mo" = "24h",
): { id: string; name: string } {
  const t = formatTurnover(minTurnoverUsd);
  const v = formatVol(minVolatilityPct);
  const name = `${t}/${v} [${metricsRange}]`;
  const id = sanitizeId(`${t}_${v.replace("%", "pct")}_${metricsRange}`);
  return { id, name };
}

function sanitizeId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "universe";
}

function formatTurnover(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "0";
  if (usd >= 1_000_000) {
    const m = usd / 1_000_000;
    const s = Number.isInteger(m) ? String(m) : String(Math.round(m * 10) / 10);
    return `${s}m`;
  }
  if (usd >= 1_000) {
    const k = usd / 1_000;
    const s = Number.isInteger(k) ? String(k) : String(Math.round(k * 10) / 10);
    return `${s}k`;
  }
  return String(Math.round(usd));
}

function formatVol(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  const s = Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 10) / 10);
  return `${s}%`;
}
