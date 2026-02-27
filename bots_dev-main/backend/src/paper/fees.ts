/**
 * Fees (stub).
 * TODO: maker/taker fee application.
 */
export function calcFee(notional: number, feeRate: number): number {
  return notional * feeRate;
}
