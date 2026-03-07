export type OptimizerDatasetMode = "snapshot" | "followTail";

const HOUR_MS = 60 * 60 * 1000;

export function defaultFollowTailStartInput(nowMs = Date.now()): string {
  return toDatetimeLocalInput(nowMs - 24 * HOUR_MS);
}

export function toDatetimeLocalInput(tsMs: number): string {
  const d = new Date(tsMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export function parseDatetimeLocalInput(input: string): number | null {
  const text = String(input ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function resolveDatasetWindowInput(args: {
  datasetMode: OptimizerDatasetMode;
  followTailStartInput: string;
}): { timeRangeFromTs?: number | null; timeRangeToTs?: number | null; error?: string } {
  if (args.datasetMode === "snapshot") return {};
  const fromTs = parseDatetimeLocalInput(args.followTailStartInput);
  if (!Number.isFinite(fromTs as number)) {
    return { error: "Follow Tail start date is required." };
  }
  return {
    timeRangeFromTs: Math.floor(fromTs as number),
    timeRangeToTs: null,
  };
}

