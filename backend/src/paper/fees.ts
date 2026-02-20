export function estimateFeeUSDT(executedNotional: number, feeRate: number): number {
  return executedNotional * feeRate;
}
