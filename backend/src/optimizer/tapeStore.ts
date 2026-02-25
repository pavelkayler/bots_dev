import fs from "node:fs";
import path from "node:path";

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
};

const TAPES_DIR = path.resolve(process.cwd(), "data", "tapes");

export function ensureDir() {
  fs.mkdirSync(TAPES_DIR, { recursive: true });
}

export function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) {
    throw new Error("invalid_tape_id");
  }
  return id;
}

export function getTapePath(id: string): string {
  return path.join(TAPES_DIR, `${safeId(id)}.jsonl`);
}

export function listTapes(): TapeListItem[] {
  ensureDir();
  const files = fs.readdirSync(TAPES_DIR).filter((file) => file.endsWith(".jsonl"));

  const tapes: TapeListItem[] = [];

  for (const file of files) {
    const id = file.slice(0, -".jsonl".length);
    const fullPath = path.join(TAPES_DIR, file);

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
      });
    } catch {
      // ignore
    }
  }

  tapes.sort((a, b) => b.createdAt - a.createdAt);
  return tapes;
}
