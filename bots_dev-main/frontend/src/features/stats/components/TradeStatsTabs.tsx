import { useEffect, useMemo, useState } from "react";
import { Tabs, Tab } from "react-bootstrap";
import type { SymbolRow } from "../../../shared/types/domain";
import { useRuntimeConfig } from "../../config/hooks/useRuntimeConfig";
import { getTradeExcursionsBySymbol, getTradeStatsBySymbol, type TradeExcursionsRow, type TradeStatsBySymbolRow, type TradeStatsMode } from "../api/tradeStatsApi";
import { TradeStatsBySymbolTable } from "./TradeStatsBySymbolTable";
import { TradeExcursionsTable } from "./TradeExcursionsTable";

export function TradeStatsTabs({ rows }: { rows: SymbolRow[] }) {
  const { config } = useRuntimeConfig();
  const [activeTab, setActiveTab] = useState<"both" | "long" | "short" | "excursions">("both");
  const [statsByMode, setStatsByMode] = useState<Record<TradeStatsMode, TradeStatsBySymbolRow[]>>({ both: [], long: [], short: [] });
  const [excursions, setExcursions] = useState<TradeExcursionsRow[]>([]);

  const symbols = useMemo(() => config?.universe?.symbols ?? [], [config]);

  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;
    const load = async () => {
      if (activeTab === "excursions") {
        const res = await getTradeExcursionsBySymbol();
        if (stopped) return;
        setExcursions((res.stats ?? []).filter((r) => r.tpTrades > 0 || r.slTrades > 0));
        return;
      }
      const res = await getTradeStatsBySymbol(activeTab as TradeStatsMode);
      if (stopped) return;
      const filtered = (res.stats ?? []).filter((row) => {
        if (activeTab === "both") return row.trades > 0;
        if (activeTab === "long") return row.longTrades > 0;
        return row.shortTrades > 0;
      });
      setStatsByMode((prev) => ({ ...prev, [activeTab]: filtered }));
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
        <TradeStatsBySymbolTable stats={enriched} mode="both" />
      </Tab>
      <Tab eventKey="long" title="Long">
        <TradeStatsBySymbolTable stats={enriched} mode="long" />
      </Tab>
      <Tab eventKey="short" title="Short">
        <TradeStatsBySymbolTable stats={enriched} mode="short" />
      </Tab>
      <Tab eventKey="excursions" title="Excursions">
        <TradeExcursionsTable rows={excursions} />
      </Tab>
    </Tabs>
  );
}
