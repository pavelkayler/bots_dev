import type { UniverseMetricsRange } from "./universeAverageBuilder.js";
import { normalizeUniverseMetricsRange } from "./universeAverageBuilder.js";

type BybitKlineResponse = {
  retCode?: number;
  result?: {
    list?: Array<Array<string | number>>;
  };
};

type BybitOpenInterestItem = {
  openInterest?: string;
  timestamp?: string;
};

type BybitOpenInterestResponse = {
  retCode?: number;
  result?: {
    list?: BybitOpenInterestItem[];
  };
};

export type UniverseSymbolRangeSummary = {
  symbol: string;
  high: number | null;
  low: number | null;
  priceChangePct: number | null;
  openInterestValue: number | null;
  openInterestChangePct: number | null;
};

const HOURS_BY_RANGE: Record<UniverseMetricsRange, number> = {
  "24h": 24,
  "48h": 48,
  "1w": 24 * 7,
  "2w": 24 * 14,
  "1mo": 24 * 30,
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchKlineHighLow(
  restBaseUrl: string,
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<{ high: number; low: number; close: number } | null> {
  const base = restBaseUrl.replace(/\/+$/g, "");
  const url = new URL(`${base}/v5/market/kline`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "60");
  url.searchParams.set("start", String(startMs));
  url.searchParams.set("end", String(endMs));
  url.searchParams.set("limit", "1000");

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as BybitKlineResponse;
  if ((json?.retCode ?? 0) !== 0) return null;

  const list = Array.isArray(json?.result?.list) ? json.result!.list! : [];
  if (!list.length) return null;
  let high: number | null = null;
  let low: number | null = null;
  let close: number | null = null;
  let latestTs = Number.NEGATIVE_INFINITY;
  for (const row of list) {
    const ts = num(row?.[0]);
    const rowHigh = num(row?.[2]);
    const rowLow = num(row?.[3]);
    const rowClose = num(row?.[4]);
    if (rowHigh == null || rowLow == null || rowClose == null) continue;
    high = high == null ? rowHigh : Math.max(high, rowHigh);
    low = low == null ? rowLow : Math.min(low, rowLow);
    if (ts != null && ts >= latestTs) {
      latestTs = ts;
      close = rowClose;
    }
  }
  if (high == null || low == null || close == null) return null;
  return { high, low, close };
}

async function fetchOiCloseValue(
  restBaseUrl: string,
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<number | null> {
  const base = restBaseUrl.replace(/\/+$/g, "");
  const url = new URL(`${base}/v5/market/open-interest`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("intervalTime", "5min");
  url.searchParams.set("startTime", String(startMs));
  url.searchParams.set("endTime", String(endMs));
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as BybitOpenInterestResponse;
  if ((json?.retCode ?? 0) !== 0) return null;
  const list = Array.isArray(json?.result?.list) ? json.result!.list! : [];
  if (!list.length) return null;
  const v = num(list[0]?.openInterest);
  return v == null ? null : v;
}

export function computePctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export async function buildUniverseSymbolRangeSummary(input: {
  restBaseUrl: string;
  symbols: string[];
  range?: unknown;
}): Promise<{ range: UniverseMetricsRange; rows: UniverseSymbolRangeSummary[] }> {
  const range = normalizeUniverseMetricsRange(input.range);
  const hours = HOURS_BY_RANGE[range];
  const nowMs = Date.now();
  const periodMs = hours * 60 * 60 * 1000;
  const currentStart = nowMs - periodMs;
  const prevStart = currentStart - periodMs;
  const prevEnd = currentStart;

  const symbols = Array.isArray(input.symbols)
    ? input.symbols.map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean)
    : [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    unique.push(symbol);
  }

  const rows = new Array<UniverseSymbolRangeSummary>(unique.length);
  let cursor = 0;
  const concurrency = 6;

  async function worker() {
    while (cursor < unique.length) {
      const i = cursor;
      cursor += 1;
      const symbol = unique[i];
      if (!symbol) continue;
      const [hlCurrent, hlPrev, oiCurrent, oiPrev] = await Promise.all([
        fetchKlineHighLow(input.restBaseUrl, symbol, currentStart, nowMs),
        fetchKlineHighLow(input.restBaseUrl, symbol, prevStart, prevEnd),
        fetchOiCloseValue(input.restBaseUrl, symbol, currentStart, nowMs),
        fetchOiCloseValue(input.restBaseUrl, symbol, prevStart, prevEnd),
      ]);
      rows[i] = {
        symbol,
        high: hlCurrent?.high ?? null,
        low: hlCurrent?.low ?? null,
        priceChangePct: computePctChange(hlCurrent?.close ?? null, hlPrev?.close ?? null),
        openInterestValue: oiCurrent,
        openInterestChangePct: computePctChange(oiCurrent, oiPrev),
      };
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, unique.length || 1)) }, () => worker()));
  return { range, rows: rows.filter(Boolean) };
}
