/**
 * Rounding helpers (stub).
 * TODO: round price to tickSize, qty to qtyStep (down), enforce minQty.
 */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.floor(value / step) * step;
}
