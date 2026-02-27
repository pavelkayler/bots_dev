import WebSocket from "ws";

export type UniverseBuildRequest = {
  wsUrl: string;
  symbols: string[];
  minTurnoverUsd: number;
  minVolatilityPct: number;
  collectMs?: number;
};

export type UniverseBuildResult = {
  collectMs: number;
  seededSymbols: number;
  subscribedSymbols: number;
  receivedSymbols: number;
  matchedSymbols: number;
  symbols: string[];
};

type TickerRow = {
  turnover24h?: string | number;
  highPrice24h?: string | number;
  lowPrice24h?: string | number;
};

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeData(data: any): Array<Record<string, any>> {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object");
  if (data && typeof data === "object") return [data];
  return [];
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function calcVolPct(high: number, low: number): number {
  if (low <= 0) return 0;
  return ((high - low) / low) * 100;
}

function isUsdtPerpSymbol(symbol: string): boolean {
  if (!/^[A-Z0-9]{2,28}USDT$/.test(symbol)) return false;
  if (symbol.includes("-")) return false;
  return true;
}

function chunkTopicsByCharLimit(topics: string[], maxChars = 18_000): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;

  for (const t of topics) {
    const addLen = (cur.length === 0 ? 0 : 1) + t.length;
    if (cur.length > 0 && curLen + addLen > maxChars) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(t);
    curLen += addLen;
  }

  if (cur.length) chunks.push(cur);
  return chunks;
}

export async function buildUniverseByTickersWs(req: UniverseBuildRequest): Promise<UniverseBuildResult> {
  const collectMs = Math.max(1000, Math.min(20_000, Math.floor(req.collectMs ?? 5000)));
  const minTurnoverUsd = Math.max(0, Number(req.minTurnoverUsd) || 0);
  const minVolatilityPct = Math.max(0, Number(req.minVolatilityPct) || 0);

  const seededRaw = Array.isArray(req.symbols)
    ? req.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : [];

  const seededFiltered = seededRaw.filter(isUsdtPerpSymbol);

  const seededUniq: string[] = [];
  const seen = new Set<string>();
  for (const s of seededFiltered) {
    if (!seen.has(s)) {
      seen.add(s);
      seededUniq.push(s);
    }
  }

  const subscribeLimit = 1000;
  const subscribed = seededUniq.slice(0, subscribeLimit);

  return await new Promise<UniverseBuildResult>((resolve, reject) => {
    const ws = new WebSocket(req.wsUrl);

    const bySymbol = new Map<string, { turnover: number; high: number; low: number }>();
    let gotAny = false;
    let subscribeOk: boolean | null = null;

    const finish = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    const done = () => {
      const receivedSymbols = bySymbol.size;

      const matched = Array.from(bySymbol.entries())
        .filter(([symbol, v]) => {
          if (!isUsdtPerpSymbol(symbol)) return false;
          if (v.turnover < minTurnoverUsd) return false;
          const vol = calcVolPct(v.high, v.low);
          if (vol < minVolatilityPct) return false;
          return true;
        })
        .sort((a, b) => b[1].turnover - a[1].turnover)
        .map(([symbol]) => symbol);

      resolve({
        collectMs,
        seededSymbols: seededUniq.length,
        subscribedSymbols: subscribed.length,
        receivedSymbols,
        matchedSymbols: matched.length,
        symbols: matched,
      });
    };

    const timeout = setTimeout(() => {
      finish();

      if (subscribeOk === false) {
        reject(new Error("subscribe_failed"));
        return;
      }

      if (!gotAny) {
        reject(new Error("no_tickers_received"));
        return;
      }

      done();
    }, collectMs);

    ws.on("open", () => {
      try {
        const topics = subscribed.map((s) => `tickers.${s}`);
        const batches = chunkTopicsByCharLimit(topics);

        let delay = 0;
        for (const batch of batches) {
          setTimeout(() => {
            try {
              ws.send(JSON.stringify({ op: "subscribe", args: batch }));
            } catch {
              // ignore
            }
          }, delay);
          delay += 150;
        }
      } catch (e: any) {
        clearTimeout(timeout);
        finish();
        reject(new Error(String(e?.message ?? e)));
      }
    });

    ws.on("message", (buf) => {
      const msgStr = typeof buf === "string" ? buf : buf.toString("utf8");
      const msg = safeJsonParse(msgStr);
      if (!msg) return;

      if (typeof msg.success === "boolean" && msg.op === "subscribe") {
        if (msg.success === false) subscribeOk = false;
        else if (subscribeOk !== false) subscribeOk = true;
        return;
      }

      const topic = typeof msg.topic === "string" ? msg.topic : "";
      const type = msg.type === "snapshot" || msg.type === "delta" ? msg.type : null;
      if (!topic || !type) return;

      if (!topic.startsWith("tickers.")) return;

      const symbol = topic.slice("tickers.".length);
      if (!symbol) return;

      const rows = normalizeData(msg.data);
      for (const row of rows) {
        const r = row as TickerRow;

        const turnover = num(r.turnover24h);
        const high = num(r.highPrice24h);
        const low = num(r.lowPrice24h);

        if (turnover == null || high == null || low == null) continue;

        gotAny = true;
        bySymbol.set(symbol, { turnover, high, low });
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      finish();
      reject(err instanceof Error ? err : new Error("ws_error"));
    });
  });
}
