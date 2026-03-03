import { parentPort } from "node:worker_threads";
import { runOptimizationCore, type RunOptimizationArgs } from "../runner.js";

if (!parentPort) {
  throw new Error("optimizer_worker_parent_port_missing");
}

let paused = false;
let cancelled = false;
let currentJobId: string | null = null;
let runStarted = false;
const PROGRESS_THROTTLE_MS = 75;

type PendingProgress = {
  done: number;
  total: number;
  updatedAtMs: number;
  previewResults: any[];
  donePercent?: number;
};

let lastProgressSentAtMs = 0;
let pendingProgressFlushTimer: NodeJS.Timeout | null = null;
let pendingProgress: PendingProgress | null = null;

const ROWS_APPEND_THROTTLE_MS = 200;
const ROWS_APPEND_BATCH_SIZE = 50;
let pendingRowsAppend: any[] = [];
let pendingRowsAppendTimer: NodeJS.Timeout | null = null;
let lastRowsAppendSentAtMs = 0;

function clearPendingRowsAppendTimer() {
  if (!pendingRowsAppendTimer) return;
  clearTimeout(pendingRowsAppendTimer);
  pendingRowsAppendTimer = null;
}

function flushPendingRowsAppend() {
  clearPendingRowsAppendTimer();
  if (!pendingRowsAppend.length) return;
  const rows = pendingRowsAppend;
  pendingRowsAppend = [];
  parentPort?.postMessage({
    type: "rows_append",
    jobId: currentJobId,
    rows,
  });
  lastRowsAppendSentAtMs = Date.now();
}

function queueRowsAppend(rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  pendingRowsAppend.push(...rows);
  if (pendingRowsAppend.length >= ROWS_APPEND_BATCH_SIZE) {
    flushPendingRowsAppend();
    return;
  }
  const now = Date.now();
  if (lastRowsAppendSentAtMs === 0 || now - lastRowsAppendSentAtMs >= ROWS_APPEND_THROTTLE_MS) {
    flushPendingRowsAppend();
    return;
  }
  if (pendingRowsAppendTimer) return;
  const waitMs = Math.max(0, ROWS_APPEND_THROTTLE_MS - (now - lastRowsAppendSentAtMs));
  pendingRowsAppendTimer = setTimeout(() => {
    flushPendingRowsAppend();
  }, waitMs);
}

let lastBlacklistEmitAtMs = 0;
let lastBlacklistCount = -1;
let lastBlacklistSkipped = -1;

function toDonePercent(done: number, total: number) {
  if (total <= 0) return 0;
  const pct = (done / total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function clearPendingProgressTimer() {
  if (!pendingProgressFlushTimer) return;
  clearTimeout(pendingProgressFlushTimer);
  pendingProgressFlushTimer = null;
}

function postProgress(progress: PendingProgress) {
  const donePercent = clampPercent(typeof progress.donePercent === "number" ? progress.donePercent : toDonePercent(progress.done, progress.total));
  parentPort?.postMessage({
    type: "progress",
    jobId: currentJobId,
    donePercent,
    done: progress.done,
    total: progress.total,
    updatedAtMs: progress.updatedAtMs,
    previewResults: progress.previewResults.slice(0, 200),
  });
  lastProgressSentAtMs = Date.now();
}

function flushPendingProgress() {
  clearPendingProgressTimer();
  if (!pendingProgress) return;
  postProgress(pendingProgress);
  pendingProgress = null;
}

function queueProgress(done: number, total: number, previewResults: any[], donePercent?: number) {
  pendingProgress = {
    done,
    total,
    updatedAtMs: Date.now(),
    previewResults,
    ...(typeof donePercent === "number" ? { donePercent: clampPercent(donePercent) } : {}),
  };
  const now = Date.now();
  if (lastProgressSentAtMs === 0 || now - lastProgressSentAtMs >= PROGRESS_THROTTLE_MS) {
    flushPendingProgress();
    return;
  }
  if (pendingProgressFlushTimer) return;
  const waitMs = Math.max(0, PROGRESS_THROTTLE_MS - (now - lastProgressSentAtMs));
  pendingProgressFlushTimer = setTimeout(() => {
    flushPendingProgress();
  }, waitMs);
}

async function waitWhilePaused() {
  while (paused) {
    if (cancelled) return "cancelled" as const;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return cancelled ? "cancelled" as const : "resumed" as const;
}

parentPort.on("message", async (msg: any) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "pause") {
    paused = true;
    return;
  }
  if (msg.type === "resume") {
    paused = false;
    return;
  }
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type !== "start" || runStarted) return;

  runStarted = true;
  currentJobId = String(msg.jobId ?? "");
  paused = false;
  cancelled = false;
  lastProgressSentAtMs = 0;
  pendingProgress = null;
  clearPendingProgressTimer();
  pendingRowsAppend = [];
  clearPendingRowsAppendTimer();
  lastRowsAppendSentAtMs = 0;

  try {
    queueProgress(0, 100, [], 0);

    const output = await runOptimizationCore(msg.runPayload as RunOptimizationArgs, {
      shouldCancel: () => cancelled,
      shouldPause: () => paused,
      waitWhilePaused,
      onLoadProgress: () => {
        queueProgress(0, 100, [], 0);
      },
      onProgress: (_done, total, previewResults) => {
        const done = Number(_done) || 0;
        const donePct = toDonePercent(done, total);
        queueProgress(done, total, Array.isArray(previewResults) ? previewResults : [], donePct);
      },
      onRowsAppend: (rows: any[]) => {
        queueRowsAppend(Array.isArray(rows) ? rows : []);
      },
      onCheckpoint: ({ done, total, donePercent, partialResults }) => {
        parentPort?.postMessage({
          type: "checkpoint",
          jobId: currentJobId,
          checkpointMeta: {
            done,
            total,
            donePercent,
            updatedAtMs: Date.now(),
            previewResults: partialResults.slice(0, 200),
          },
        });
      },
      onBlacklistUpdate: (summary) => {
        const now = Date.now();
        const count = Number(summary?.count) || 0;
        const skipped = Number(summary?.skipped) || 0;
        const changed = count !== lastBlacklistCount || skipped !== lastBlacklistSkipped;
        if (!changed && now - lastBlacklistEmitAtMs < 2000) return;
        lastBlacklistCount = count;
        lastBlacklistSkipped = skipped;
        lastBlacklistEmitAtMs = now;
        parentPort?.postMessage({
          type: "progress",
          jobId: currentJobId,
          updatedAtMs: now,
          messageAppend: `blacklist=${count} skipped=${skipped}`,
        });
      },
    });

    flushPendingProgress();
    flushPendingRowsAppend();
    if (!output.cancelled) {
      postProgress({
        done: 100,
        total: 100,
        donePercent: 100,
        updatedAtMs: Date.now(),
        previewResults: output.results,
      });
    }

    parentPort?.postMessage({
      type: "done",
      jobId: currentJobId,
      finalResults: output.results,
      finalMessage: output,
    });
  } catch (e: any) {
    clearPendingProgressTimer();
    clearPendingRowsAppendTimer();
    parentPort?.postMessage({ type: "error", jobId: currentJobId, errorMessage: String(e?.message ?? e) });
  }
});
