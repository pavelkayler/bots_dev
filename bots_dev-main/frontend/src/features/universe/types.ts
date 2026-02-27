export type UniverseMeta = {
  id: string;
  name: string;
  minTurnoverUsd: number;
  minVolatilityPct: number;
  createdAt: number;
  updatedAt: number;
  count: number;
};

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
