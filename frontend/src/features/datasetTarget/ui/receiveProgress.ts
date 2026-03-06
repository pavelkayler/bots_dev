import type { ReceiveDataJob } from "../../dataReceive/api/dataReceiveApi";

function formatEta(etaSec: number | null | undefined): string {
  const sec = Number(etaSec);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `ETA: ~${m}m ${s}s`;
}

export function formatReceiveProgressLine(job: ReceiveDataJob | null): string {
  if (!job) return "";
  const eta = formatEta(job.progress.etaSec);
  return [
    `${job.progress.completedSteps}/${job.progress.totalSteps}`,
    job.progress.currentSymbol,
    job.progress.message,
    eta,
  ].filter(Boolean).join(" - ");
}
