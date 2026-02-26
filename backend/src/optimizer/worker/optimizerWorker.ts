import { parentPort } from "node:worker_threads";
import { runOptimizationCore, type RunOptimizationArgs } from "../runner.js";

if (!parentPort) {
  throw new Error("optimizer_worker_parent_port_missing");
}

let paused = false;
let cancelled = false;
let currentJobId: string | null = null;
let runStarted = false;

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

  try {
    const output = await runOptimizationCore(msg.runPayload as RunOptimizationArgs, {
      shouldCancel: () => cancelled,
      shouldPause: () => paused,
      waitWhilePaused,
      onProgress: (_done, total, previewResults) => {
        const done = Number(_done) || 0;
        const donePercent = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 10_000) / 100)) : 0;
        parentPort?.postMessage({
          type: "progress",
          jobId: currentJobId,
          donePercent,
          done,
          total,
          updatedAtMs: Date.now(),
          previewResults: previewResults.slice(0, 200),
        });
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

    parentPort?.postMessage({
      type: "done",
      jobId: currentJobId,
      finalResults: output.results,
      finalMessage: output,
    });
  } catch (e: any) {
    parentPort?.postMessage({ type: "error", jobId: currentJobId, errorMessage: String(e?.message ?? e) });
  }
});
