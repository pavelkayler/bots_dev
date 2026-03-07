export type LoopInputValidationPayload = {
  candidates: string;
  seed: string;
  minTrades: string;
  optTfMin: string;
  loopRunsCount: string;
  simMarginPerTrade: string;
  simLeverage: string;
};

function parseInteger(text: string): number | null {
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

export function validateLoopStartInput(payload: LoopInputValidationPayload): string | null {
  const candidates = parseInteger(payload.candidates);
  if (candidates == null || candidates < 1 || candidates > 2000) {
    return "Candidates must be an integer between 1 and 2000.";
  }
  const seed = parseInteger(payload.seed);
  if (seed == null || seed < 0) {
    return "Seed must be a non-negative integer.";
  }
  const minTrades = parseInteger(payload.minTrades);
  if (minTrades == null || minTrades < 0) {
    return "Min trades must be a non-negative integer.";
  }
  const optTfMin = parseInteger(payload.optTfMin);
  if (optTfMin == null || optTfMin < 5) {
    return "Signal window must be at least 5 minutes.";
  }
  const runsCount = parseInteger(payload.loopRunsCount);
  if (runsCount == null || runsCount < 1) {
    return "Runs count must be an integer >= 1.";
  }
  const margin = Number(payload.simMarginPerTrade);
  if (!Number.isFinite(margin) || margin <= 0) {
    return "Margin per trade must be > 0.";
  }
  const leverage = Number(payload.simLeverage);
  if (!Number.isFinite(leverage) || leverage < 1) {
    return "Leverage must be >= 1.";
  }
  return null;
}
