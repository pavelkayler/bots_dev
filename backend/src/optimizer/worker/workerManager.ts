import { Worker } from "node:worker_threads";

export type WorkerManagerHandlers = {
  onProgress: (payload: any) => void;
  onCheckpoint: (payload: any) => void;
  onDone: (payload: any) => void;
  onError: (payload: any) => void;
};

class OptimizerWorkerManager {
  private workers = new Map<string, Worker>();

  private resolveWorkerEntry() {
    const currentPath = import.meta.url;
    const inDist = currentPath.includes("/dist/") || currentPath.includes("\\dist\\");
    return new URL(inDist ? "./optimizerWorker.js" : "./optimizerWorker.ts", import.meta.url);
  }

  start(jobId: string, runPayload: any, handlers: WorkerManagerHandlers) {
    if (this.workers.size > 0) {
      throw new Error("optimizer_worker_busy");
    }
    const worker = new Worker(this.resolveWorkerEntry(), { type: "module" } as any);
    this.workers.set(jobId, worker);

    worker.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "progress") handlers.onProgress(msg);
      if (msg.type === "checkpoint") handlers.onCheckpoint(msg);
      if (msg.type === "done") {
        handlers.onDone(msg);
        this.terminate(jobId);
      }
      if (msg.type === "error") {
        handlers.onError(msg);
        this.terminate(jobId);
      }
    });

    worker.on("error", (err: any) => {
      handlers.onError({ type: "error", jobId, errorMessage: String(err?.message ?? err) });
      this.terminate(jobId);
    });

    worker.on("exit", () => {
      this.workers.delete(jobId);
    });

    worker.postMessage({ type: "start", jobId, runPayload });
  }

  pause(jobId: string) {
    this.workers.get(jobId)?.postMessage({ type: "pause" });
  }

  resume(jobId: string) {
    this.workers.get(jobId)?.postMessage({ type: "resume" });
  }

  cancel(jobId: string) {
    this.workers.get(jobId)?.postMessage({ type: "cancel" });
  }

  terminate(jobId: string) {
    const worker = this.workers.get(jobId);
    if (!worker) return;
    this.workers.delete(jobId);
    void worker.terminate();
  }
}

export const optimizerWorkerManager = new OptimizerWorkerManager();
