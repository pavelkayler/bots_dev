export type UniverseMeta = {
  id: string;
  name: string;
  minTurnoverUsd: number;
  minVolatilityPct: number;
  metricsRange?: "24h" | "48h" | "1w" | "2w" | "1mo";
  createdAt: number;
  updatedAt: number;
  count: number;
};

export type UniverseMetricsRange = "24h" | "48h" | "1w" | "2w" | "1mo";

export type UniverseFile = {
  meta: UniverseMeta;
  symbols: string[];
};

export type UniversesListResponse = {
  universes: UniverseMeta[];
};

export type UniverseCreateResponse = {
  universe: UniverseFile;
  stats: {
    collectMs: number;
    receivedSymbols: number;
    matchedSymbols: number;
    symbols: string[];
  };
};

export type UniverseSymbolSummaryRow = {
  symbol: string;
  high: number | null;
  low: number | null;
  priceChangePct: number | null;
  openInterestValue: number | null;
  openInterestChangePct: number | null;
};

export type UniverseSymbolSummaryResponse = {
  universeId: string;
  range: UniverseMetricsRange;
  rows: UniverseSymbolSummaryRow[];
};

export type UniverseAvailableSymbolRow = {
  symbol: string;
  avgTurnoverUsd24h: number;
  avgVolatilityPct: number;
};

export type UniverseAvailableSymbolsResponse = {
  range: UniverseMetricsRange;
  rows: UniverseAvailableSymbolRow[];
  cached: boolean;
  cachedAtMs: number;
  nowMs: number;
};
