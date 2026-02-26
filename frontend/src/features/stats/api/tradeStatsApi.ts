import { getApiBase } from "../../../shared/config/env";
import { getJson } from "../../../shared/api/http";

export type TradeStatsMode = "both" | "long" | "short";

export type TradeStatsBySymbolRow = {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  fees: number;
  funding: number;
  lastCloseTs: number | null;
  longTrades: number;
  longWins: number;
  shortTrades: number;
  shortWins: number;
};

export type TradeExcursionsRow = {
  symbol: string;
  tpTrades: number;
  tpWorstMinRoiPct: number | null;
  slTrades: number;
  slBestMaxRoiPct: number | null;
};

export async function getTradeStatsBySymbol(mode: TradeStatsMode): Promise<{ sessionId: string | null; mode: TradeStatsMode; stats: TradeStatsBySymbolRow[] }> {
  const base = getApiBase();
  return await getJson(`${base}/api/stats/trade-by-symbol?mode=${encodeURIComponent(mode)}`);
}

export async function getTradeExcursionsBySymbol(): Promise<{ sessionId: string | null; stats: TradeExcursionsRow[] }> {
  const base = getApiBase();
  return await getJson(`${base}/api/stats/trade-excursions-by-symbol`);
}
