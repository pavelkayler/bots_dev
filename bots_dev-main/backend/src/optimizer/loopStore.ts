import fs from "node:fs";
import path from "node:path";

export type OptimizerLoopRunPayload = {
  [key: string]: unknown;
  tapeIds: string[];
  candidates: number;
  seed: number;
  directionMode: "both" | "long" | "short";
  optTfMin?: number;
  minTrades: number;
  excludeNegative: boolean;
  rememberNegatives: boolean;
  ranges?: any;
  precision?: any;
};

export type OptimizerLoopState = {
  loopId: string;
  isRunning: boolean;
  isPaused: boolean;
  isInfinite: boolean;
  runsCount: number;
  runIndex: number;
  createdAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
  lastJobId: string | null;
  runPayload: OptimizerLoopRunPayload;
};

const LOOP_STATE_PATH = path.resolve(process.cwd(), "data", "optimizer_loops", "current.json");

function ensureDir() {
  fs.mkdirSync(path.dirname(LOOP_STATE_PATH), { recursive: true });
}

export function readLoopState(): OptimizerLoopState | null {
  if (!fs.existsSync(LOOP_STATE_PATH)) return null;
  try {
    const raw = fs.readFileSync(LOOP_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OptimizerLoopState>;
    if (!parsed || typeof parsed.loopId !== "string" || !parsed.runPayload || !Array.isArray(parsed.runPayload.tapeIds)) return null;
    return {
      loopId: parsed.loopId,
      isRunning: Boolean(parsed.isRunning),
      isPaused: Boolean(parsed.isPaused),
      isInfinite: Boolean(parsed.isInfinite),
      runsCount: Math.max(1, Math.floor(Number(parsed.runsCount) || 1)),
      runIndex: Math.max(0, Math.floor(Number(parsed.runIndex) || 0)),
      createdAtMs: Number(parsed.createdAtMs) || Date.now(),
      updatedAtMs: Number(parsed.updatedAtMs) || Date.now(),
      finishedAtMs: typeof parsed.finishedAtMs === "number" ? parsed.finishedAtMs : null,
      lastJobId: typeof parsed.lastJobId === "string" ? parsed.lastJobId : null,
      runPayload: parsed.runPayload as OptimizerLoopRunPayload,
    };
  } catch {
    return null;
  }
}

export function writeLoopState(state: OptimizerLoopState) {
  ensureDir();
  fs.writeFileSync(LOOP_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function clearLoopState() {
  if (!fs.existsSync(LOOP_STATE_PATH)) return;
  fs.unlinkSync(LOOP_STATE_PATH);
}

export function recoverLoopStateOnBoot() {
  const state = readLoopState();
  if (!state || !state.isRunning) return state;
  const recovered: OptimizerLoopState = {
    ...state,
    isPaused: true,
    finishedAtMs: null,
    updatedAtMs: Date.now(),
  };
  writeLoopState(recovered);
  return recovered;
}
