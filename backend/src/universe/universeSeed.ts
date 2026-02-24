export type UniverseSeedRequest = {
  restBaseUrl: string;
};

type InstrumentsInfoResponse = {
  retCode?: number;
  retMsg?: string;
  result?: {
    list?: Array<Record<string, any>>;
    nextPageCursor?: string;
  };
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function toStr(v: any): string {
  return String(v ?? "");
}

function isUsdtPerpSymbol(symbol: string): boolean {
  if (!/^[A-Z0-9]{2,28}USDT$/.test(symbol)) return false;
  if (symbol.includes("-")) return false;
  return true;
}

function pickTradingLinearUsdtPerp(list: Array<Record<string, any>>): string[] {
  const out: string[] = [];

  for (const it of list) {
    const symbol = toStr(it?.symbol).toUpperCase();
    if (!symbol) continue;

    const status = toStr(it?.status);
    if (status !== "Trading") continue;

    if (!isUsdtPerpSymbol(symbol)) continue;

    const settleCoin = toStr(it?.settleCoin).toUpperCase();
    if (settleCoin && settleCoin !== "USDT") continue;

    const contractType = toStr(it?.contractType).toLowerCase();
    if (contractType && !contractType.includes("perpetual")) continue;

    out.push(symbol);
  }

  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const s of out) {
    if (!seen.has(s)) {
      seen.add(s);
      uniq.push(s);
    }
  }
  return uniq;
}

export async function seedLinearUsdtPerpSymbols(req: UniverseSeedRequest): Promise<string[]> {
  const base = req.restBaseUrl.replace(/\/+$/g, "");
  const limit = 500;

  let cursor = "";
  const symbols: string[] = [];

  for (let page = 0; page < 50; page++) {
    const url = new URL(`${base}/v5/market/instruments-info`);
    url.searchParams.set("category", "linear");
    url.searchParams.set("status", "Trading");
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`seed_http_${res.status}`);

    const json = (await res.json()) as InstrumentsInfoResponse;
    if (json?.retCode && json.retCode !== 0) {
      throw new Error(`seed_retCode_${json.retCode}_${json.retMsg ?? ""}`);
    }

    const list = Array.isArray(json?.result?.list) ? (json!.result!.list as Array<Record<string, any>>) : [];
    const picked = pickTradingLinearUsdtPerp(list);
    symbols.push(...picked);

    cursor = String(json?.result?.nextPageCursor ?? "");
    if (!cursor) break;

    await sleep(80);
  }

  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const s of symbols) {
    if (!seen.has(s)) {
      seen.add(s);
      uniq.push(s);
    }
  }
  return uniq;
}
