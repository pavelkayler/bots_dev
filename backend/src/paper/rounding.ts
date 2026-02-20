export function getStepDecimals(step: number): number {
  const stepString = step.toString();
  if (!stepString.includes('.')) {
    return 0;
  }
  return stepString.split('.')[1]?.length ?? 0;
}

export function floorToStep(value: number, step: number): number {
  if (step <= 0) {
    return value;
  }
  const factor = Math.floor(value / step);
  const decimals = getStepDecimals(step);
  return Number((factor * step).toFixed(decimals));
}

export function roundDownToTick(price: number, tickSize: number): number {
  return floorToStep(price, tickSize);
}

export function roundUpToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) {
    return price;
  }
  const decimals = getStepDecimals(tickSize);
  const factor = Math.ceil(price / tickSize);
  return Number((factor * tickSize).toFixed(decimals));
}
