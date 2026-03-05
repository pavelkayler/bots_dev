import type { ReceiveDataJob } from "../../dataReceive/api/dataReceiveApi";

export function formatReceiveProgressLine(job: ReceiveDataJob | null): string {
  if (!job) return "";
  return [
    `${job.progress.completedSteps}/${job.progress.totalSteps}`,
    job.progress.currentSymbol,
    job.progress.message,
  ].filter(Boolean).join(" - ");
}
