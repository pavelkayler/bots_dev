export function estimateFeeUSDT(executedNotional: number, feeRate: number): number {
  return executedNotional * feeRate;
}

export function estimateExitMakerFeeUSDT(exitPrice: number, qty: number, makerRate: number): number {
  return estimateFeeUSDT(exitPrice * qty, makerRate);
}
