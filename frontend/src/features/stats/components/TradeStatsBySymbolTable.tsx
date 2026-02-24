import { useMemo, useState, type CSSProperties } from "react";
import { Table } from "react-bootstrap";
import { fmtMoney, fmtTime } from "../../../shared/utils/format";
import type { TradeStatsBySymbol } from "../hooks/useTradeStatsBySymbol";

type SortKey =
  | "symbol"
  | "trades"
  | "wins"
  | "losses"
  | "winRate"
  | "netPnl"
  | "fees"
  | "funding"
  | "avgHoldMs"
  | "lastCloseTs";

function formatAvgHold(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function TradeStatsBySymbolTable({ stats }: { stats: TradeStatsBySymbol[] }) {
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
            ? a.row.lastCloseTs ?? 0
            : (a.row as any)[sortKey];
      const bv =
        sortKey === "winRate"
          ? bWinRate
          : sortKey === "lastCloseTs"
            ? b.row.lastCloseTs ?? 0
            : (b.row as any)[sortKey];

      let cmp = 0;
      if (typeof av === "string" || typeof bv === "string") {
        cmp = String(av).localeCompare(String(bv));
      } else {
        cmp = Number(av) - Number(bv);
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

  const thButton: CSSProperties = { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };
  const td: CSSProperties = { whiteSpace: "nowrap", fontSize: 13 };

  return (
    <div style={{ overflowX: "auto" }}>
      <Table size="sm" striped hover>
        <thead>
          <tr>
            <th style={thButton} onClick={() => onSort("symbol")}>Symbol</th>
            <th style={thButton} onClick={() => onSort("trades")}>Trades</th>
            <th style={thButton} onClick={() => onSort("wins")}>Wins</th>
            <th style={thButton} onClick={() => onSort("losses")}>Losses</th>
            <th style={thButton} onClick={() => onSort("winRate")}>Win rate %</th>
            <th style={thButton} onClick={() => onSort("netPnl")}>Net PnL (realized)</th>
            <th style={thButton} onClick={() => onSort("fees")}>Fees</th>
            <th style={thButton} onClick={() => onSort("funding")}>Funding</th>
            <th style={thButton} onClick={() => onSort("avgHoldMs")}>Avg hold</th>
            <th style={thButton} onClick={() => onSort("lastCloseTs")}>Last close</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const winRate = row.trades > 0 ? (row.wins / row.trades) * 100 : 0;
            return (
              <tr key={row.symbol}>
                <td style={td}>{row.symbol}</td>
                <td style={td}>{row.trades}</td>
                <td style={td}>{row.wins}</td>
                <td style={td}>{row.losses}</td>
                <td style={td}>{winRate.toFixed(2)}</td>
                <td style={td}>{fmtMoney(row.netPnl)}</td>
                <td style={td}>{fmtMoney(row.fees)}</td>
                <td style={td}>{fmtMoney(row.funding)}</td>
                <td style={td}>{formatAvgHold(row.avgHoldMs)}</td>
                <td style={td}>{fmtTime(row.lastCloseTs)}</td>
              </tr>
            );
          })}
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ opacity: 0.75 }}>
                No closed trades yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
