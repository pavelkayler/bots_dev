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
const LOADING_PROGRESS_MAX = 5;
const RUN_PROGRESS_START = 5;
const RUN_PROGRESS_SCALE = 0.95;

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

  try {
    queueProgress(0, 100, [], 0);

    const output = await runOptimizationCore(msg.runPayload as RunOptimizationArgs, {
      shouldCancel: () => cancelled,
      shouldPause: () => paused,
      waitWhilePaused,
      onLoadProgress: (bytesRead, totalBytes) => {
        const ratio = totalBytes > 0 ? bytesRead / totalBytes : 1;
        const loadingPct = LOADING_PROGRESS_MAX * Math.max(0, Math.min(1, ratio));
        queueProgress(0, 100, [], loadingPct);
      },
      onProgress: (_done, total, previewResults) => {
        const done = Number(_done) || 0;
        const runPct = total > 0 ? (done / total) * 100 : 0;
        const donePct = RUN_PROGRESS_START + runPct * RUN_PROGRESS_SCALE;
        queueProgress(done, total, Array.isArray(previewResults) ? previewResults : [], donePct);
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
        parentPort?.postMessage({ type: "progress", jobId: currentJobId, updatedAtMs: Date.now(), messageAppend: `blacklist=${summary.count} skipped=${summary.skipped}` });
      },
    });

    flushPendingProgress();
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
    parentPort?.postMessage({ type: "error", jobId: currentJobId, errorMessage: String(e?.message ?? e) });
  }
});
