import { setTimeout as sleepTimeout } from "node:timers/promises";

export const DEFAULT_COINGLASS_BASE_URL = "https://open-api-v3.coinglass.com";
const COINGLASS_WINDOW_MS = 60_000;
const COINGLASS_MAX_REQUESTS_PER_WINDOW = 30;
const COINGLASS_POINT_LIMIT = 1000;

export type CoinGlassPoint = {
  timestamp: number;
  openInterest: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

export class CoinGlassRateLimitError extends Error {
  retryAfterSec: number;

  constructor(message: string, retryAfterSec: number) {
    super(message);
    this.name = "CoinGlassRateLimitError";
    this.retryAfterSec = Math.max(1, Math.floor(retryAfterSec || 1));
  }
}

export class CoinGlassClientError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CoinGlassClientError";
    this.code = code;
  }
}

export class CoinGlassLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly nowFn: () => number;
  private readonly sleepFn: SleepLike;
  private windowStartMs: number | null = null;
  private requestCount = 0;

  constructor(args?: {
    maxRequests?: number;
    windowMs?: number;
    nowFn?: () => number;
    sleepFn?: SleepLike;
  }) {
    this.maxRequests = args?.maxRequests ?? COINGLASS_MAX_REQUESTS_PER_WINDOW;
    this.windowMs = args?.windowMs ?? COINGLASS_WINDOW_MS;
    this.nowFn = args?.nowFn ?? (() => Date.now());
    this.sleepFn = args?.sleepFn ?? (async (ms: number) => { await sleepTimeout(ms); });
  }

  async acquire(): Promise<number> {
    while (true) {
      const now = this.nowFn();
      if (this.windowStartMs == null || now - this.windowStartMs >= this.windowMs) {
        this.windowStartMs = now;
        this.requestCount = 0;
      }
      if (this.requestCount < this.maxRequests) {
        this.requestCount += 1;
        return 0;
      }
      const waitMs = Math.max(1, this.windowMs - (now - this.windowStartMs));
      await this.sleepFn(waitMs);
      return waitMs;
    }
  }
}

export function resolveCoinGlassBybitSymbol(bybitSymbol: string): string | null {
  const symbol = String(bybitSymbol || "").trim().toUpperCase();
  if (!symbol) return null;
  const match = /^([A-Z0-9]{2,20})USDT$/.exec(symbol);
  if (!match) return null;
  return `${match[1]}USDT`;
}

export function validateCoinGlassBybitSymbols(symbols: string[]): { mapped: Record<string, string>; unsupported: string[] } {
  const mapped: Record<string, string> = {};
  const unsupported: string[] = [];
  for (const symbol of symbols) {
    const resolved = resolveCoinGlassBybitSymbol(symbol);
    if (!resolved) {
      unsupported.push(symbol);
      continue;
    }
    mapped[symbol] = resolved;
  }
  return { mapped, unsupported };
}

function parsePoints(payload: unknown): CoinGlassPoint[] {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const sources = [
    body.data,
    body.result,
    (body.data && typeof body.data === "object" ? (body.data as any).list : null),
    (body.result && typeof body.result === "object" ? (body.result as any).list : null),
  ];

  let rawList: unknown[] = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      rawList = source;
      break;
    }
  }

  const out: CoinGlassPoint[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const tsRaw = Number(row.timestamp ?? row.ts ?? row.time ?? row.t);
    const oiRaw = row.openInterest ?? row.open_interest ?? row.oi;
    if (!Number.isFinite(tsRaw)) continue;
    const openInterest = String(oiRaw ?? "").trim();
    if (!openInterest) continue;
    const timestamp = tsRaw > 10_000_000_000 ? Math.floor(tsRaw) : Math.floor(tsRaw * 1000);
    out.push({ timestamp, openInterest });
  }

  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export class CoinGlassClient {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly limiter: CoinGlassLimiter;

  constructor(args?: {
    apiKey?: string | null;
    baseUrl?: string;
    fetchImpl?: FetchLike;
    limiter?: CoinGlassLimiter;
  }) {
    const keyFromEnv = process.env.COINGLASS_API_KEY ?? null;
    this.apiKey = (args?.apiKey ?? keyFromEnv)?.trim() || null;
    this.baseUrl = (args?.baseUrl ?? process.env.COINGLASS_BASE_URL ?? DEFAULT_COINGLASS_BASE_URL).replace(/\/+$/g, "");
    this.fetchImpl = args?.fetchImpl ?? fetch;
    this.limiter = args?.limiter ?? new CoinGlassLimiter();
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchBybitOpenInterest1m(args: {
    bybitSymbol: string;
    startMs: number;
    endMs: number;
    onRateLimitWait?: (waitSec: number) => void;
  }): Promise<CoinGlassPoint[]> {
    if (!this.apiKey) {
      throw new CoinGlassClientError("coinglass_key_missing", "COINGLASS_API_KEY is required for 1m OI gap fill.");
    }
    const mapped = resolveCoinGlassBybitSymbol(args.bybitSymbol);
    if (!mapped) {
      throw new CoinGlassClientError("coinglass_symbol_unsupported", `CoinGlass symbol mapping not found for ${args.bybitSymbol}.`);
    }
    const startMs = Math.floor(args.startMs);
    const endMs = Math.floor(args.endMs);
    if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs)) {
      return [];
    }

    const waitedMs = await this.limiter.acquire();
    if (waitedMs > 0) args.onRateLimitWait?.(Math.max(1, Math.ceil(waitedMs / 1000)));

    const paths = [
      "/api/futures/open-interest/history",
      "/api/futures/openInterest/ohlc-history",
    ];

    let lastHttpStatus = 0;
    for (const apiPath of paths) {
      const url = new URL(`${this.baseUrl}${apiPath}`);
      url.searchParams.set("exchange", "bybit");
      url.searchParams.set("symbol", mapped);
      url.searchParams.set("interval", "1m");
      url.searchParams.set("startTime", String(startMs));
      url.searchParams.set("endTime", String(endMs));
      url.searchParams.set("limit", String(COINGLASS_POINT_LIMIT));

      const res = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          "CG-API-KEY": this.apiKey,
          Accept: "application/json",
        },
      });
      lastHttpStatus = res.status;

      if (res.status === 429) {
        const retryAfter = Math.max(1, Number(res.headers.get("retry-after") ?? 1));
        throw new CoinGlassRateLimitError("CoinGlass rate limit reached.", retryAfter);
      }

      const payload = (await res.json()) as any;
      const codeText = String(payload?.code ?? payload?.retCode ?? "");
      const msg = String(payload?.msg ?? payload?.message ?? "");
      const isUpgradePlan = codeText === "40001"
        || codeText === "403"
        || /upgrade/i.test(msg)
        || /interval is not available/i.test(msg);
      if (isUpgradePlan) {
        throw new CoinGlassClientError("coinglass_plan_unsupported_1m", msg || "CoinGlass plan does not support 1m interval.");
      }

      if (!res.ok) {
        if (res.status >= 500 || res.status === 404) continue;
        throw new CoinGlassClientError("coinglass_http_error", `CoinGlass request failed with status ${res.status}.`);
      }

      const codeNum = Number(payload?.code ?? payload?.retCode ?? 0);
      if (Number.isFinite(codeNum) && codeNum !== 0) {
        if (codeNum === 429) {
          throw new CoinGlassRateLimitError("CoinGlass rate limit reached.", 1);
        }
        throw new CoinGlassClientError("coinglass_api_error", msg || "CoinGlass API error");
      }
      return parsePoints(payload);
    }

    throw new CoinGlassClientError("coinglass_http_error", `CoinGlass request failed with status ${lastHttpStatus || 500}.`);
  }
}
