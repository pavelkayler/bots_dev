export type UniverseMetricsRange = "24h" | "48h" | "1w" | "2w" | "1mo";

export type UniverseAverageBuildRequest = {
  restBaseUrl: string;
  symbols: string[];
  minTurnoverUsd: number;
  minVolatilityPct: number;
  range: UniverseMetricsRange;
};

export type UniverseAverageBuildResult = {
  range: UniverseMetricsRange;
  rangeHours: number;
  seededSymbols: number;
  subscribedSymbols: number;
  receivedSymbols: number;
  matchedSymbols: number;
  collectMs: number;
  symbols: string[];
};

const HOURS_BY_RANGE: Record<UniverseMetricsRange, number> = {
  "24h": 24,
  "48h": 48,
  "1w": 24 * 7,
  "2w": 24 * 14,
  "1mo": 24 * 30,
};

type BybitKlineResponse = {
  retCode?: number;
  retMsg?: string;
  result?: {
    list?: Array<Array<string | number>>;
  };
};

type SymbolMetrics = {
  symbol: string;
  avgTurnoverUsd24h: number;
  avgVolatilityPct: number;
};

function isUsdtPerpSymbol(symbol: string): boolean {
  if (!/^[A-Z0-9]{2,28}USDT$/.test(symbol)) return false;
  if (symbol.includes("-")) return false;
  return true;
}

function parseNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function calcVolatilityPct(high: number, low: number): number {
  if (low <= 0) return 0;
  return ((high - low) / low) * 100;
}

export function normalizeUniverseMetricsRange(raw: unknown): UniverseMetricsRange {
  const value = String(raw ?? "").trim();
  if (value === "48h" || value === "1w" || value === "2w" || value === "1mo") return value;
  return "24h";
}

async function fetchSymbolMetrics(restBaseUrl: string, symbol: string, rangeHours: number): Promise<SymbolMetrics | null> {
  const base = restBaseUrl.replace(/\/+$/g, "");
  const url = new URL(`${base}/v5/market/kline`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "60");
  url.searchParams.set("limit", String(Math.max(1, Math.min(1000, rangeHours))));

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) return null;

  const json = (await res.json()) as BybitKlineResponse;
  if ((json?.retCode ?? 0) !== 0) return null;

  const list = Array.isArray(json?.result?.list) ? json.result!.list! : [];
  if (!list.length) return null;

  let sumTurnover = 0;
  let sumVolatility = 0;
  let count = 0;

  for (const row of list) {
    const high = parseNum(row?.[2]);
    const low = parseNum(row?.[3]);
    const turnover = parseNum(row?.[6]);
    if (high == null || low == null || turnover == null) continue;
    sumTurnover += turnover;
    sumVolatility += calcVolatilityPct(high, low);
    count += 1;
  }

  if (count <= 0) return null;
  const avgHourlyTurnoverUsd = sumTurnover / count;
  return {
    symbol,
    avgTurnoverUsd24h: avgHourlyTurnoverUsd * 24,
    avgVolatilityPct: sumVolatility / count,
  };
}

export async function buildUniverseByAverageMetrics(req: UniverseAverageBuildRequest): Promise<UniverseAverageBuildResult> {
  const minTurnoverUsd = Math.max(0, Number(req.minTurnoverUsd) || 0);
  const minVolatilityPct = Math.max(0, Number(req.minVolatilityPct) || 0);
  const range = normalizeUniverseMetricsRange(req.range);
  const rangeHours = HOURS_BY_RANGE[range];
  const startedAt = Date.now();

  const seededRaw = Array.isArray(req.symbols)
    ? req.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : [];

  const seededFiltered = seededRaw.filter(isUsdtPerpSymbol);
  const seen = new Set<string>();
  const seededUniq: string[] = [];
  for (const s of seededFiltered) {
    if (seen.has(s)) continue;
    seen.add(s);
    seededUniq.push(s);
  }

  const subscribed = seededUniq.slice(0, 1000);
  const metrics: SymbolMetrics[] = [];
  const concurrency = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < subscribed.length) {
      const idx = cursor;
      cursor += 1;
      const symbol = subscribed[idx];
      if (!symbol) continue;
      const row = await fetchSymbolMetrics(req.restBaseUrl, symbol, rangeHours);
      if (row) metrics.push(row);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const matched = metrics
    .filter((m) => m.avgTurnoverUsd24h >= minTurnoverUsd && m.avgVolatilityPct >= minVolatilityPct)
    .sort((a, b) => b.avgTurnoverUsd24h - a.avgTurnoverUsd24h)
    .map((m) => m.symbol);

  return {
    range,
    rangeHours,
    seededSymbols: seededUniq.length,
    subscribedSymbols: subscribed.length,
    receivedSymbols: metrics.length,
    matchedSymbols: matched.length,
    collectMs: Math.max(0, Date.now() - startedAt),
    symbols: matched,
  };
}
