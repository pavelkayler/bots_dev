import type { PositionSide } from './models';

export function shouldApplyFunding(nowTs: number, nextFundingTimeTs?: number): boolean {
  if (nextFundingTimeTs === undefined) {
    return false;
  }
  return nowTs >= nextFundingTimeTs;
}

export function calculateFundingPaymentUSDT(input: {
  side: PositionSide;
  notionalUSDT: number;
  fundingRate: number;
}): number {
  const basePayment = input.notionalUSDT * input.fundingRate;
  if (input.side === 'LONG') {
    return -basePayment;
  }
  return basePayment;
}
