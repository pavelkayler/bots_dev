export function upsertTimestampFields<T extends { startMs: number }>(
  rows: Map<number, T>,
  startMs: number,
  patch: Partial<T>,
): T {
  const prev = rows.get(startMs);
  const next = {
    ...(prev ?? ({ startMs } as T)),
    ...patch,
    startMs,
  } as T;
  rows.set(startMs, next);
  return next;
}

export function mergeFieldLayerByTimestamp<T extends { startMs: number }>(
  baseRows: T[],
  layer: Map<number, Record<string, unknown>>,
): T[] {
  return baseRows.map((row) => {
    const extra = layer.get(Number(row.startMs));
    if (!extra) return row;
    return { ...row, ...extra };
  });
}
