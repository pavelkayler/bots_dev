import { CoinGlassClient, CoinGlassClientError, CoinGlassRateLimitError, DEFAULT_COINGLASS_BASE_URL } from "../coinglass/CoinGlassClient.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ProviderCapabilityStatus =
  | "ok"
  | "missing_key"
  | "plan_unsupported"
  | "rate_limited"
  | "http_error";

export type ProviderCapabilityCheck = {
  id: string;
  provider: "bybit" | "coinglass";
  label: string;
  required: boolean;
  status: ProviderCapabilityStatus;
  available: boolean;
  message: string;
  latencyMs: number | null;
};

const INTERVALS_UP_TO_1H = ["5m", "15m", "30m", "1h", "4h"] as const;

function asMessage(error: unknown): string {
  return String((error as any)?.message ?? error ?? "unknown error");
}

async function checkBybitEndpoint(args: {
  id: string;
  label: string;
  required: boolean;
  restBaseUrl: string;
  path: string;
  requireNonEmptyList?: boolean;
  fetchImpl: FetchLike;
}): Promise<ProviderCapabilityCheck> {
  const startedAt = Date.now();
  try {
    const base = args.restBaseUrl.replace(/\/+$/g, "");
    const url = `${base}${args.path}`;
    const res = await args.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) {
      return {
        id: args.id,
        provider: "bybit",
        label: args.label,
        required: args.required,
        status: "http_error",
        available: false,
        message: `HTTP ${res.status}`,
        latencyMs,
      };
    }
    const payload = (await res.json()) as any;
    const retCode = Number(payload?.retCode ?? 0);
    if (Number.isFinite(retCode) && retCode !== 0) {
      const msg = String(payload?.retMsg ?? payload?.retExtInfo?.message ?? "retCode != 0");
      return {
        id: args.id,
        provider: "bybit",
        label: args.label,
        required: args.required,
        status: "http_error",
        available: false,
        message: msg,
        latencyMs,
      };
    }
    if (args.requireNonEmptyList) {
      const list = payload?.result?.list;
      if (!Array.isArray(list) || list.length === 0) {
        return {
          id: args.id,
          provider: "bybit",
          label: args.label,
          required: args.required,
          status: "http_error",
          available: false,
          message: "No data for requested interval.",
          latencyMs,
        };
      }
    }
    return {
      id: args.id,
      provider: "bybit",
      label: args.label,
      required: args.required,
      status: "ok",
      available: true,
      message: "OK",
      latencyMs,
    };
  } catch (error) {
    return {
      id: args.id,
      provider: "bybit",
      label: args.label,
      required: args.required,
      status: "http_error",
      available: false,
      message: asMessage(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function checkCoinGlassOpenInterest1m(fetchImpl: FetchLike): Promise<ProviderCapabilityCheck> {
  const startedAt = Date.now();
  try {
    const client = new CoinGlassClient({ fetchImpl });
    if (!client.hasApiKey()) {
      return {
        id: "coinglass_oi_1m_history",
        provider: "coinglass",
        label: "Metric: OI history (1m)",
        required: false,
        status: "missing_key",
        available: false,
        message: "COINGLASS_API_KEY is missing.",
        latencyMs: 0,
      };
    }
    const endMs = Date.now();
    const startMs = endMs - 10 * 60_000;
    await client.fetchBybitOpenInterest1m({
      bybitSymbol: "BTCUSDT",
      startMs,
      endMs,
    });
    return {
      id: "coinglass_oi_1m_history",
      provider: "coinglass",
      label: "Metric: OI history (1m)",
      required: false,
      status: "ok",
      available: true,
      message: "OK",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof CoinGlassRateLimitError) {
      return {
        id: "coinglass_oi_1m_history",
        provider: "coinglass",
        label: "Metric: OI history (1m)",
        required: false,
        status: "rate_limited",
        available: false,
        message: `Rate limited. Retry in ~${error.retryAfterSec}s`,
        latencyMs: Date.now() - startedAt,
      };
    }
    if (error instanceof CoinGlassClientError) {
      const status = error.code === "coinglass_plan_unsupported_1m" ? "plan_unsupported" : "http_error";
      return {
        id: "coinglass_oi_1m_history",
        provider: "coinglass",
        label: "Metric: OI history (1m)",
        required: false,
        status,
        available: false,
        message: error.message,
        latencyMs: Date.now() - startedAt,
      };
    }
    return {
      id: "coinglass_oi_1m_history",
      provider: "coinglass",
      label: "Metric: OI history (1m)",
      required: false,
      status: "http_error",
      available: false,
      message: asMessage(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function checkCoinGlassEndpoint(args: {
  id: string;
  label: string;
  path: string;
  query: Record<string, string>;
  required: boolean;
  baseUrlOverride?: string;
  fetchImpl: FetchLike;
}): Promise<ProviderCapabilityCheck> {
  const startedAt = Date.now();
  const apiKey = String(process.env.COINGLASS_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      id: args.id,
      provider: "coinglass",
      label: args.label,
      required: args.required,
      status: "missing_key",
      available: false,
      message: "COINGLASS_API_KEY is missing.",
      latencyMs: 0,
    };
  }
  try {
    const baseUrl = (args.baseUrlOverride ?? process.env.COINGLASS_BASE_URL ?? DEFAULT_COINGLASS_BASE_URL).replace(/\/+$/g, "");
    const url = new URL(`${baseUrl}${args.path}`);
    for (const [key, value] of Object.entries(args.query)) {
      url.searchParams.set(key, value);
    }
    const res = await args.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        "CG-API-KEY": apiKey,
        Accept: "application/json",
      },
    });
    const latencyMs = Date.now() - startedAt;
    if (res.status === 429) {
      return {
        id: args.id,
        provider: "coinglass",
        label: args.label,
        required: args.required,
        status: "rate_limited",
        available: false,
        message: "Rate limited.",
        latencyMs,
      };
    }
    const payload = (await res.json()) as any;
    const codeText = String(payload?.code ?? payload?.retCode ?? "");
    const msg = String(payload?.msg ?? payload?.message ?? "");
    const isUpgradePlan = codeText === "40001"
      || codeText === "403"
      || /upgrade/i.test(msg)
      || /interval is not available/i.test(msg);
    if (isUpgradePlan) {
      return {
        id: args.id,
        provider: "coinglass",
        label: args.label,
        required: args.required,
        status: "plan_unsupported",
        available: false,
        message: msg || "Upgrade plan",
        latencyMs,
      };
    }
    if (!res.ok) {
      if (res.status >= 500 && args.path.includes("/cvd/")) {
        return {
          id: args.id,
          provider: "coinglass",
          label: args.label,
          required: args.required,
          status: "plan_unsupported",
          available: false,
          message: "Endpoint unavailable on current plan or account scope.",
          latencyMs,
        };
      }
      return {
        id: args.id,
        provider: "coinglass",
        label: args.label,
        required: args.required,
        status: "http_error",
        available: false,
        message: `HTTP ${res.status}`,
        latencyMs,
      };
    }
    const codeNum = Number(payload?.code ?? payload?.retCode ?? 0);
    if (Number.isFinite(codeNum) && codeNum !== 0) {
      return {
        id: args.id,
        provider: "coinglass",
        label: args.label,
        required: args.required,
        status: "http_error",
        available: false,
        message: msg || `API code ${codeNum}`,
        latencyMs,
      };
    }
    return {
      id: args.id,
      provider: "coinglass",
      label: args.label,
      required: args.required,
      status: "ok",
      available: true,
      message: "OK",
      latencyMs,
    };
  } catch (error) {
    return {
      id: args.id,
      provider: "coinglass",
      label: args.label,
      required: args.required,
      status: "http_error",
      available: false,
      message: asMessage(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function checkCoinGlassEndpointCandidates(args: {
  id: string;
  label: string;
  paths: string[];
  query: Record<string, string>;
  required: boolean;
  baseUrlOverride?: string;
  fetchImpl: FetchLike;
}): Promise<ProviderCapabilityCheck> {
  const attempts: ProviderCapabilityCheck[] = [];
  for (const path of args.paths) {
    const row = await checkCoinGlassEndpoint({
      id: args.id,
      label: args.label,
      path,
      query: args.query,
      required: args.required,
      ...(args.baseUrlOverride ? { baseUrlOverride: args.baseUrlOverride } : {}),
      fetchImpl: args.fetchImpl,
    });
    attempts.push(row);
    if (row.available) {
      return {
        ...row,
        message: `${row.message} (path: ${path})`,
      };
    }
    if (row.status === "missing_key" || row.status === "rate_limited") {
      return row;
    }
  }
  const firstPlanUnsupported = attempts.find((row) => row.status === "plan_unsupported");
  if (firstPlanUnsupported) {
    return {
      ...firstPlanUnsupported,
      message: `${firstPlanUnsupported.message} (all known liquidation history paths checked)`,
    };
  }
  const firstHttpError = attempts.find((row) => row.status === "http_error");
  if (firstHttpError) {
    return {
      ...firstHttpError,
      message: `${firstHttpError.message} (all known liquidation history paths failed)`,
    };
  }
  return attempts[0] ?? {
    id: args.id,
    provider: "coinglass",
    label: args.label,
    required: args.required,
    status: "http_error",
    available: false,
    message: "Unknown error",
    latencyMs: null,
  };
}

async function checkCoinGlassIntervalsUntilSuccess(args: {
  idPrefix: string;
  labelPrefix: string;
  paths: string[];
  required: boolean;
  queryBuilder: (interval: string) => Record<string, string>;
  baseUrlOverride?: string;
  fetchImpl: FetchLike;
}): Promise<ProviderCapabilityCheck[]> {
  const rows: ProviderCapabilityCheck[] = [];
  let firstSuccessInterval: string | null = null;
  let stopReason: "missing_key" | "rate_limited" | null = null;

  for (const interval of INTERVALS_UP_TO_1H) {
    if (firstSuccessInterval) {
      rows.push({
        id: `${args.idPrefix}_${interval}`,
        provider: "coinglass",
        label: `${args.labelPrefix} (${interval})`,
        required: args.required,
        status: "ok",
        available: true,
        message: `Not needed: ${firstSuccessInterval} is available (higher TF can be derived).`,
        latencyMs: null,
      });
      continue;
    }
    if (stopReason) {
      rows.push({
        id: `${args.idPrefix}_${interval}`,
        provider: "coinglass",
        label: `${args.labelPrefix} (${interval})`,
        required: args.required,
        status: stopReason,
        available: false,
        message: stopReason === "missing_key" ? "COINGLASS_API_KEY is missing." : "Rate limited.",
        latencyMs: null,
      });
      continue;
    }
    const row = await checkCoinGlassEndpointCandidates({
      id: `${args.idPrefix}_${interval}`,
      label: `${args.labelPrefix} (${interval})`,
      paths: args.paths,
      query: args.queryBuilder(interval),
      required: args.required,
      ...(args.baseUrlOverride ? { baseUrlOverride: args.baseUrlOverride } : {}),
      fetchImpl: args.fetchImpl,
    });
    rows.push(row);
    if (row.available) {
      firstSuccessInterval = interval;
      continue;
    }
    if (row.status === "missing_key") {
      stopReason = "missing_key";
      continue;
    }
    if (row.status === "rate_limited") {
      stopReason = "rate_limited";
      continue;
    }
  }
  return rows;
}

export async function collectProviderCapabilities(args?: {
  bybitRestUrl?: string;
  botId?: string;
  fetchImpl?: FetchLike;
}): Promise<ProviderCapabilityCheck[]> {
  const fetchImpl = args?.fetchImpl ?? fetch;
  const bybitRestUrl = (args?.bybitRestUrl ?? process.env.BYBIT_REST_URL ?? "https://api.bybit.com").replace(/\/+$/g, "");
  const botId = String(args?.botId ?? "oi-momentum-v1");
  const checks: ProviderCapabilityCheck[] = [];

  checks.push(await checkBybitEndpoint({
    id: "price_kline_1m",
    label: "Metric: price candles (1m)",
    required: true,
    restBaseUrl: bybitRestUrl,
    path: "/v5/market/kline?category=linear&symbol=BTCUSDT&interval=1&limit=1",
    fetchImpl,
  }));
  checks.push(await checkBybitEndpoint({
    id: "bybit_oi_history_1m",
    label: "Metric: open interest path (1m)",
    required: false,
    restBaseUrl: bybitRestUrl,
    path: "/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1min&limit=1",
    requireNonEmptyList: true,
    fetchImpl,
  }));
  checks.push(await checkBybitEndpoint({
    id: "bybit_oi_history_5m",
    label: "Metric: open interest path (5m)",
    required: true,
    restBaseUrl: bybitRestUrl,
    path: "/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&limit=1",
    requireNonEmptyList: true,
    fetchImpl,
  }));
  checks.push(await checkBybitEndpoint({
    id: "funding_history",
    label: "Metric: funding history",
    required: true,
    restBaseUrl: bybitRestUrl,
    path: "/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1",
    fetchImpl,
  }));

  checks.push(await checkCoinGlassOpenInterest1m(fetchImpl));
  if (botId === "signal-multi-factor-v1") {
    checks.push(await checkBybitEndpoint({
      id: "signal_trade_flow",
      label: "Metric: trade flow (recent trades)",
      required: true,
      restBaseUrl: bybitRestUrl,
      path: "/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=1",
      fetchImpl,
    }));
    checks.push(await checkBybitEndpoint({
      id: "signal_microstructure_orderbook",
      label: "Metric: orderbook snapshot",
      required: true,
      restBaseUrl: bybitRestUrl,
      path: "/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=1",
      fetchImpl,
    }));
    const liquidationChecks = await checkCoinGlassIntervalsUntilSuccess({
      idPrefix: "signal_liquidation_history",
      labelPrefix: "Metric: liquidation history",
      paths: [
        "/api/futures/liquidation/history",
      ],
      baseUrlOverride: "https://open-api-v4.coinglass.com",
      required: false,
      queryBuilder: (interval) => ({
        exchange: "Bybit",
        symbol: "BTCUSDT",
        interval,
        startTime: String(Date.now() - 24 * 60 * 60_000),
        endTime: String(Date.now()),
      }),
      fetchImpl,
    });
    checks.push(...liquidationChecks);
    checks.push(await checkBybitEndpoint({
      id: "signal_cvd_source_bybit",
      label: "Metric: CVD source (Bybit public trades)",
      required: true,
      restBaseUrl: bybitRestUrl,
      path: "/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=1",
      fetchImpl,
    }));
  }
  return checks;
}
