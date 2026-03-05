import { z } from "zod";

export const workerProgressMessageSchema = z.object({
  type: z.literal("progress"),
  jobId: z.string(),
  donePercent: z.number().min(0).max(100).optional(),
  done: z.number().optional(),
  total: z.number().optional(),
  updatedAtMs: z.number(),
  previewResults: z.array(z.unknown()).optional(),
  messageAppend: z.string().optional(),
});

export const workerRowsAppendMessageSchema = z.object({
  type: z.literal("rows_append"),
  jobId: z.string().nullable(),
  rows: z.array(z.unknown()),
});

export const workerDoneMessageSchema = z.object({
  type: z.literal("done"),
  jobId: z.string().nullable(),
  finalResults: z.array(z.unknown()),
  finalMessage: z.unknown(),
});

export const workerErrorMessageSchema = z.object({
  type: z.literal("error"),
  jobId: z.string().nullable(),
  errorMessage: z.string(),
});

export const workerMessageSchema = z.union([
  workerProgressMessageSchema,
  workerRowsAppendMessageSchema,
  workerDoneMessageSchema,
  workerErrorMessageSchema,
]);

export function clampWorkerProgressPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export function canEmitProgress(lastSentAtMs: number, nowMs: number, throttleMs: number): boolean {
  return lastSentAtMs <= 0 || nowMs - lastSentAtMs >= throttleMs;
}
