import fs from "node:fs";
import path from "node:path";

export type OptimizerLoopRunPayload = {
  [key: string]: unknown;
  selectedBotId?: string;
  selectedBotPresetId?: string;
  datasetMode?: "snapshot" | "followTail";
  timeRangeFromTs?: number | null;
  timeRangeToTs?: number | null;
  datasetHistoryIds: string[];
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
  loopIndex: number;
  createdAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
  lastJobId: string | null;
  lastError?: {
    statusCode: number;
    bodySnippet: string;
  } | null;
  runPayload: OptimizerLoopRunPayload;
  progress?: OptimizerLoopProgressState;
};

export type OptimizerLoopProgressState = {
  jobId: string;
  status: "running" | "done" | "canceled" | "error";
  runIndex: number;
  runTotal: number;
  runPct: number;
  overallPct: number;
  updatedAt: number;
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
    if (!parsed || typeof parsed.loopId !== "string" || !parsed.runPayload || !Array.isArray(parsed.runPayload.datasetHistoryIds)) return null;
    return {
      loopId: parsed.loopId,
      isRunning: Boolean(parsed.isRunning),
      isPaused: Boolean(parsed.isPaused),
      isInfinite: Boolean(parsed.isInfinite),
      runsCount: Math.max(1, Math.floor(Number(parsed.runsCount) || 1)),
      runIndex: Math.max(0, Math.floor(Number(parsed.runIndex) || 0)),
      loopIndex: Math.max(0, Math.floor(Number(parsed.loopIndex) || 0)),
      createdAtMs: Number(parsed.createdAtMs) || Date.now(),
      updatedAtMs: Number(parsed.updatedAtMs) || Date.now(),
      finishedAtMs: typeof parsed.finishedAtMs === "number" ? parsed.finishedAtMs : null,
      lastJobId: typeof parsed.lastJobId === "string" ? parsed.lastJobId : null,
      lastError: parsed.lastError && typeof parsed.lastError === "object"
        ? {
          statusCode: Math.max(0, Math.floor(Number((parsed.lastError as any).statusCode) || 0)),
          bodySnippet: String((parsed.lastError as any).bodySnippet ?? "").slice(0, 300),
        }
        : null,
      runPayload: parsed.runPayload as OptimizerLoopRunPayload,
      ...(parsed.progress && typeof parsed.progress === "object" ? {
        progress: {
          jobId: String((parsed.progress as any).jobId ?? ""),
          status: (["running", "done", "canceled", "error"].includes(String((parsed.progress as any).status))
            ? String((parsed.progress as any).status)
            : "running") as OptimizerLoopProgressState["status"],
          runIndex: Math.max(0, Math.floor(Number((parsed.progress as any).runIndex) || 0)),
          runTotal: Math.max(1, Math.floor(Number((parsed.progress as any).runTotal) || 1)),
          runPct: Math.max(0, Math.min(100, Number((parsed.progress as any).runPct) || 0)),
          overallPct: Math.max(0, Math.min(100, Number((parsed.progress as any).overallPct) || 0)),
          updatedAt: Number((parsed.progress as any).updatedAt) || Date.now(),
        },
      } : {}),
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
  if (!state) return state;
  const now = Date.now();
  if (!state.isRunning) {
    const normalizedStopped: OptimizerLoopState = {
      ...state,
      isRunning: false,
      isPaused: false,
      runIndex: 0,
      loopIndex: 0,
      lastJobId: null,
      createdAtMs: now,
      updatedAtMs: now,
      finishedAtMs: now,
    };
    writeLoopState(normalizedStopped);
    return normalizedStopped;
  }
  const recovered: OptimizerLoopState = {
    ...state,
    isRunning: false,
    isPaused: false,
    runIndex: 0,
    loopIndex: 0,
    lastJobId: null,
    createdAtMs: now,
    finishedAtMs: state.finishedAtMs ?? now,
    updatedAtMs: now,
  };
  writeLoopState(recovered);
  return recovered;
}
