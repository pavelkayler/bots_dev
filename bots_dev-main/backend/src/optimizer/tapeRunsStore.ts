import fs from "node:fs";
import path from "node:path";

type TapeRunEntry = {
  runsTotal: number;
  updatedAtMs: number;
};

type TapeRunsMap = Record<string, TapeRunEntry>;

const TAPE_RUNS_PATH = path.resolve(process.cwd(), "data", "optimizer_tape_runs.json");

function readStore(): TapeRunsMap {
  if (!fs.existsSync(TAPE_RUNS_PATH)) return {};
  try {
    const raw = fs.readFileSync(TAPE_RUNS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, any>;
    const out: TapeRunsMap = {};
    for (const [tapeId, value] of Object.entries(parsed ?? {})) {
      const runsTotal = Number(value?.runsTotal);
      const updatedAtMs = Number(value?.updatedAtMs);
      out[tapeId] = {
        runsTotal: Number.isFinite(runsTotal) && runsTotal >= 0 ? Math.floor(runsTotal) : 0,
        updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : Date.now(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: TapeRunsMap) {
  fs.mkdirSync(path.dirname(TAPE_RUNS_PATH), { recursive: true });
  fs.writeFileSync(TAPE_RUNS_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function incrementTapeRuns(tapeIds: string[]) {
  if (!tapeIds.length) return;
  const now = Date.now();
  const store = readStore();
  for (const tapeId of tapeIds) {
    const prev = store[tapeId];
    store[tapeId] = {
      runsTotal: (prev?.runsTotal ?? 0) + 1,
      updatedAtMs: now,
    };
  }
  writeStore(store);
}

export function getTapeRunsTotals(): Record<string, number> {
  const store = readStore();
  const totals: Record<string, number> = {};
  for (const [tapeId, value] of Object.entries(store)) {
    totals[tapeId] = value.runsTotal;
  }
  return totals;
}
