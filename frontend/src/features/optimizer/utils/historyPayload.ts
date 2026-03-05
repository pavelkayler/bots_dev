export function getDatasetHistoryIds(runPayload: unknown): string[] {
  const raw = runPayload && typeof runPayload === "object" ? (runPayload as Record<string, unknown>).datasetHistoryIds : null;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function getHistoryRunPayloadValue<T>(runPayload: unknown, key: string, fallback: T): T {
  if (!runPayload || typeof runPayload !== "object") return fallback;
  const value = (runPayload as Record<string, unknown>)[key];
  return (value == null ? fallback : value as T);
}
