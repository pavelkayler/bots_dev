/**
 * Funding (stub).
 * TODO: apply funding payments at funding timestamp.
 */
export function calcFundingPayment(positionNotional: number, fundingRate: number): number {
  return positionNotional * fundingRate;
}
