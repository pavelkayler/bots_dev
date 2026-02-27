import { buildSignedHeaders, buildSortedQueryString } from "./v5Auth.js";

type ApiResp<T> = {
  retCode: number;
  retMsg: string;
  result: T;
};

type PlaceOrderLinearParams = {
  symbol: string;
  side: "Buy" | "Sell";
  orderType: "Market" | "Limit";
  qty: string | number;
  price?: string | number;
  timeInForce?: string;
  reduceOnly?: boolean;
  takeProfit?: string | number;
  stopLoss?: string | number;
  orderLinkId?: string;
};

type CancelOrderLinearParams = {
  symbol: string;
  orderId?: string;
  orderLinkId?: string;
};

type Position = {
  symbol?: string;
  side?: string;
  size?: string;
  avgPrice?: string;
  takeProfit?: string;
  stopLoss?: string;
};

type OpenOrder = {
  symbol?: string;
  orderLinkId?: string;
  orderId?: string;
  side?: string;
  price?: string;
  qty?: string;
};

export class BybitDemoRestClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly recvWindow: number;

  constructor() {
    this.baseUrl = process.env.BYBIT_DEMO_REST_URL ?? "https://api-demo.bybit.com";
    this.apiKey = process.env.BYBIT_DEMO_API_KEY ?? "";
    this.apiSecret = process.env.BYBIT_DEMO_API_SECRET ?? "";
    this.recvWindow = Number(process.env.BYBIT_RECV_WINDOW ?? 5000);
  }

  hasCredentials(): boolean {
    return this.apiKey.length > 0 && this.apiSecret.length > 0;
  }

  private async request<T>(
    method: "GET" | "POST",
    endpoint: string,
    query?: Record<string, unknown>,
    body?: Record<string, unknown>,
    opts?: { ignoreRetCodes?: number[] },
  ): Promise<T> {
    const q = buildSortedQueryString(query ?? {});
    const url = q ? `${this.baseUrl}${endpoint}?${q}` : `${this.baseUrl}${endpoint}`;
    const timestamp = Date.now();
    const bodyString = method === "POST" ? JSON.stringify(body ?? {}) : "";

    const signed = buildSignedHeaders({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      recvWindow: this.recvWindow,
      timestamp,
      method,
      queryString: q,
      bodyString,
    });

    const headers: Record<string, string> = {
      ...signed,
      "Content-Type": "application/json",
    };

    const init: RequestInit = { method, headers };
    if (method === "POST") init.body = bodyString;
    const res = await fetch(url, init);

    const text = await res.text();
    let parsed: ApiResp<T> | null = null;
    try {
      parsed = JSON.parse(text) as ApiResp<T>;
    } catch {
      parsed = null;
    }

    const shouldIgnoreRetCode = parsed && parsed.retCode !== 0 && Array.isArray(opts?.ignoreRetCodes) && opts.ignoreRetCodes.includes(parsed.retCode);
    if (!res.ok || !parsed || (parsed.retCode !== 0 && !shouldIgnoreRetCode)) {
      const err: any = new Error(`Bybit demo REST error: ${endpoint}`);
      err.status = res.status;
      err.retCode = parsed?.retCode;
      err.retMsg = parsed?.retMsg ?? text;
      throw err;
    }

    return parsed.result;
  }

  placeOrderLinear(params: PlaceOrderLinearParams) {
    return this.request("POST", "/v5/order/create", undefined, {
      category: "linear",
      ...params,
    });
  }

  cancelOrderLinear(params: CancelOrderLinearParams) {
    return this.request("POST", "/v5/order/cancel", undefined, {
      category: "linear",
      ...params,
    });
  }

  async getOpenOrdersLinear(params: { symbol?: string } = {}): Promise<{ list: OpenOrder[] }> {
    return this.request("GET", "/v5/order/realtime", {
      category: "linear",
      ...params,
    });
  }

  async getPositionsLinear(params: { symbol?: string } = {}): Promise<{ list: Position[] }> {
    return this.request("GET", "/v5/position/list", {
      category: "linear",
      ...params,
    });
  }

  async getInstrumentsInfoLinear(params: { symbol?: string } = {}): Promise<any[]> {
    const result = await this.request<{ list?: any[] }>("GET", "/v5/market/instruments-info", {
      category: "linear",
      ...params,
    });
    return Array.isArray(result?.list) ? result.list : [];
  }

  getWalletBalance(params: { coin?: string } = {}) {
    return this.request("GET", "/v5/account/wallet-balance", {
      accountType: "UNIFIED",
      ...params,
    });
  }

  setLeverageLinear(params: { symbol: string; buyLeverage: string | number; sellLeverage: string | number }) {
    return this.request("POST", "/v5/position/set-leverage", undefined, {
      category: "linear",
      ...params,
    }, { ignoreRetCodes: [110043] });
  }

  setTradingStopLinear(params: { symbol: string; takeProfit?: string | number; stopLoss?: string | number; tpTriggerBy?: string; slTriggerBy?: string }) {
    return this.request("POST", "/v5/position/trading-stop", undefined, {
      category: "linear",
      ...params,
    });
  }
}
