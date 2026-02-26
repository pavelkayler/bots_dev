import { useMemo, useState, type CSSProperties } from "react";
import { Table } from "react-bootstrap";
import { fmtMoney, fmtNum, fmtPct, fmtTime, formatFee } from "../../../shared/utils/format";
import type { TradeStatsBySymbol } from "../hooks/useTradeStatsBySymbol";

type SortKey =
  | "symbol"
  | "turnover24hUsd"
  | "volatility24hPct"
  | "trades"
  | "longTrades"
  | "shortTrades"
  | "winRate"
  | "netPnl"
  | "fees"
  | "funding"
  | "lastCloseTs";

function finiteNum(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function TradeStatsBySymbolTable({ stats, mode }: { stats: TradeStatsBySymbol[]; mode: "both" | "long" | "short" }) {
  const [sortKey, setSortKey] = useState<SortKey>("netPnl");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const withIdx = stats.map((row, idx) => ({ row, idx }));
    withIdx.sort((a, b) => {
      const aWinRate = a.row.trades > 0 ? (a.row.wins / a.row.trades) * 100 : 0;
      const bWinRate = b.row.trades > 0 ? (b.row.wins / b.row.trades) * 100 : 0;

      const av =
        sortKey === "winRate"
          ? aWinRate
          : sortKey === "lastCloseTs"
            ? finiteNum(a.row.lastCloseTs)
            : sortKey === "longTrades"
              ? finiteNum(a.row.longTrades)
              : sortKey === "shortTrades"
                ? finiteNum(a.row.shortTrades)
                : finiteNum((a.row as any)[sortKey]);
      const bv =
        sortKey === "winRate"
          ? bWinRate
          : sortKey === "lastCloseTs"
            ? finiteNum(b.row.lastCloseTs)
            : sortKey === "longTrades"
              ? finiteNum(b.row.longTrades)
              : sortKey === "shortTrades"
                ? finiteNum(b.row.shortTrades)
                : finiteNum((b.row as any)[sortKey]);

      let cmp = 0;
      if (sortKey === "symbol") {
        cmp = String(a.row.symbol).localeCompare(String(b.row.symbol));
      } else {
        cmp = av - bv;
      }

      if (cmp === 0) return a.idx - b.idx;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return withIdx.map((x) => x.row);
  }, [stats, sortDir, sortKey]);

  function onSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "netPnl" ? "desc" : "asc");
  }

  function sideCell(count: number, wins: number) {
    const winRate = count > 0 ? `${((wins / count) * 100).toFixed(2)}%` : "-";
    return `${count} / ${winRate}`;
  }

  const thButton: CSSProperties = { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };
  const td: CSSProperties = { whiteSpace: "nowrap", fontSize: 13 };
  const showTrades = mode === "both";
  const showLongs = mode !== "short";
  const showShorts = mode !== "long";
  const emptyColSpan = 8 + (showTrades ? 1 : 0) + (showLongs ? 1 : 0) + (showShorts ? 1 : 0);

  return (
    <div style={{ overflowX: "auto" }}>
      <Table size="sm" striped hover>
        <thead>
          <tr>
            <th style={thButton} onClick={() => onSort("symbol")}>Symbol</th>
            <th style={thButton} onClick={() => onSort("turnover24hUsd")}>Turnover 24h</th>
            <th style={thButton} onClick={() => onSort("volatility24hPct")}>Volatility 24h</th>
            {showTrades ? <th style={thButton} onClick={() => onSort("trades")}>Trades</th> : null}
            {showLongs ? <th style={thButton} onClick={() => onSort("longTrades")}>Longs</th> : null}
            {showShorts ? <th style={thButton} onClick={() => onSort("shortTrades")}>Shorts</th> : null}
            <th style={thButton} onClick={() => onSort("winRate")}>W/L/WR</th>
            <th style={thButton} onClick={() => onSort("netPnl")}>Net PnL (realized)</th>
            <th style={thButton} onClick={() => onSort("fees")}>Fees</th>
            <th style={thButton} onClick={() => onSort("funding")}>Funding</th>
            <th style={thButton} onClick={() => onSort("lastCloseTs")}>Last close</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const winRate = row.trades > 0 ? (row.wins / row.trades) * 100 : 0;
            return (
              <tr key={row.symbol}>
                <td style={td}>{row.symbol}</td>
                <td style={td}>{fmtNum(row.turnover24hUsd ?? Number.NaN)}</td>
                <td style={td}>{fmtPct(row.volatility24hPct)}</td>
                {showTrades ? <td style={td}>{row.trades}</td> : null}
                {showLongs ? <td style={td}>{sideCell(row.longTrades, row.longWins)}</td> : null}
                {showShorts ? <td style={td}>{sideCell(row.shortTrades, row.shortWins)}</td> : null}
                <td style={td}>{`${row.wins}/${row.losses}/${winRate.toFixed(2)}%`}</td>
                <td style={td}>{fmtMoney(row.netPnl)}</td>
                <td style={td}>{formatFee(row.fees)}</td>
                <td style={td}>{fmtMoney(row.funding)}</td>
                <td style={td}>{fmtTime(row.lastCloseTs)}</td>
              </tr>
            );
          })}
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={emptyColSpan} style={{ opacity: 0.75 }}>
                No trades yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
