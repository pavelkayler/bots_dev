import { useEffect, useMemo, useState } from "react";
import { Tabs, Tab } from "react-bootstrap";
import type { SymbolRow } from "../../../shared/types/domain";
import { useRuntimeConfig } from "../../config/hooks/useRuntimeConfig";
import { getTradeExcursionsBySymbol, getTradeStatsBySymbol, type TradeExcursionsRow, type TradeStatsBySymbolRow, type TradeStatsMode } from "../api/tradeStatsApi";
import { TradeStatsBySymbolTable } from "./TradeStatsBySymbolTable";
import { TradeExcursionsTable } from "./TradeExcursionsTable";

function toPlaceholder(symbol: string): TradeStatsBySymbolRow {
  return { symbol, trades: 0, wins: 0, losses: 0, netPnl: 0, fees: 0, funding: 0, lastCloseTs: null, longTrades: 0, longWins: 0, shortTrades: 0, shortWins: 0 };
}

export function TradeStatsTabs({ rows }: { rows: SymbolRow[] }) {
  const { config } = useRuntimeConfig();
  const [activeTab, setActiveTab] = useState<"both" | "long" | "short" | "excursions">("both");
  const [statsByMode, setStatsByMode] = useState<Record<TradeStatsMode, TradeStatsBySymbolRow[]>>({ both: [], long: [], short: [] });
  const [excursions, setExcursions] = useState<TradeExcursionsRow[]>([]);

  const symbols = useMemo(() => config?.universe?.symbols ?? [], [config]);

  useEffect(() => {
    if (!symbols.length) return;
    setStatsByMode((prev) => ({
      both: prev.both.length ? prev.both : symbols.map(toPlaceholder),
      long: prev.long.length ? prev.long : symbols.map(toPlaceholder),
      short: prev.short.length ? prev.short : symbols.map(toPlaceholder),
    }));
    setExcursions((prev) => (prev.length ? prev : symbols.map((symbol) => ({ symbol, tpTrades: 0, tpWorstMinRoiPct: null, slTrades: 0, slBestMaxRoiPct: null }))));
  }, [symbols]);

  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;
    const load = async () => {
      if (activeTab === "excursions") {
        const res = await getTradeExcursionsBySymbol();
        if (stopped) return;
        const by = new Map((res.stats ?? []).map((r) => [r.symbol, r]));
        setExcursions(symbols.map((s) => by.get(s) ?? { symbol: s, tpTrades: 0, tpWorstMinRoiPct: null, slTrades: 0, slBestMaxRoiPct: null }));
        return;
      }
      const res = await getTradeStatsBySymbol(activeTab as TradeStatsMode);
      if (stopped) return;
      const by = new Map((res.stats ?? []).map((r) => [r.symbol, r]));
      const merged = symbols.map((s) => by.get(s) ?? toPlaceholder(s));
      setStatsByMode((prev) => ({ ...prev, [activeTab]: merged }));
    };
    void load();
    timer = window.setInterval(() => void load(), 1000);
    return () => {
      stopped = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, [activeTab, symbols]);

  const marketBySymbol = useMemo(() => {
    const m = new Map<string, { turnover24hUsd: number | null; volatility24hPct: number | null }>();
    for (const row of rows) {
      const turnover24hUsd = typeof row.turnover24hUsd === "number" && Number.isFinite(row.turnover24hUsd) ? row.turnover24hUsd : null;
      const high = typeof row.highPrice24h === "number" && Number.isFinite(row.highPrice24h) ? row.highPrice24h : null;
      const low = typeof row.lowPrice24h === "number" && Number.isFinite(row.lowPrice24h) ? row.lowPrice24h : null;
      const volatility24hPct = high != null && low != null && low > 0 ? ((high - low) / low) * 100 : null;
      m.set(row.symbol, { turnover24hUsd, volatility24hPct });
    }
    return m;
  }, [rows]);

  const enriched = (statsByMode[activeTab as TradeStatsMode] ?? []).map((r) => ({ ...r, ...(marketBySymbol.get(r.symbol) ?? { turnover24hUsd: null, volatility24hPct: null }) }));

  return (
    <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab((k as any) ?? "both")} className="mb-2">
      <Tab eventKey="both" title="Both directions">
        <TradeStatsBySymbolTable stats={enriched} />
      </Tab>
      <Tab eventKey="long" title="Long">
        <TradeStatsBySymbolTable stats={enriched} />
      </Tab>
      <Tab eventKey="short" title="Short">
        <TradeStatsBySymbolTable stats={enriched} />
      </Tab>
      <Tab eventKey="excursions" title="Excursions">
        <TradeExcursionsTable rows={excursions} />
      </Tab>
    </Tabs>
  );
}
