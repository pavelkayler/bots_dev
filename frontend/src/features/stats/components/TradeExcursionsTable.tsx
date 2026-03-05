import { useEffect, useMemo, useState } from "react";
import { Table } from "react-bootstrap";
import { TablePaginationControls, useStoredPageSize } from "../../../shared/ui/TablePaginationControls";
import type { TradeExcursionsRow } from "../api/tradeStatsApi";

type SortKey = "symbol" | "tpTrades" | "tpWorstMinRoiPct" | "slTrades" | "slBestMaxRoiPct";

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v.toFixed(2)}%`;
}

export function TradeExcursionsTable({ rows }: { rows: TradeExcursionsRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useStoredPageSize("dashboard-trade-excursions", 25);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const withIdx = rows.map((row, idx) => ({ row, idx }));
    withIdx.sort((a, b) => {
      if (sortKey === "symbol") {
        const cmp = a.row.symbol.localeCompare(b.row.symbol);
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
        return a.idx - b.idx;
      }

      const av = Number((a.row as any)[sortKey]);
      const bv = Number((b.row as any)[sortKey]);
      const aMissing = !Number.isFinite(av);
      const bMissing = !Number.isFinite(bv);
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return a.idx - b.idx;
        return aMissing ? 1 : -1;
      }
      const cmp = av - bv;
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return a.idx - b.idx;
    });
    return withIdx.map((x) => x.row);
  }, [rows, sortDir, sortKey]);
  const symbolsKey = useMemo(() => rows.map((row) => row.symbol).sort().join("|"), [rows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const start = (pageClamped - 1) * pageSize;
  const visibleRows = sortedRows.slice(start, start + pageSize);

  useEffect(() => {
    setPage(1);
  }, [symbolsKey, pageSize]);

  useEffect(() => {
    if (page !== pageClamped) setPage(pageClamped);
  }, [page, pageClamped]);

  function onSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "symbol" ? "asc" : "desc");
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <Table striped bordered hover size="sm" className="mb-0">
        <thead>
          <tr>
            <th style={{ cursor: "pointer" }} onClick={() => onSort("symbol")}>Symbol</th>
            <th style={{ cursor: "pointer" }} onClick={() => onSort("tpTrades")}>TP trades</th>
            <th style={{ cursor: "pointer" }} onClick={() => onSort("tpWorstMinRoiPct")}>Worst ROI before TP</th>
            <th style={{ cursor: "pointer" }} onClick={() => onSort("slTrades")}>SL trades</th>
            <th style={{ cursor: "pointer" }} onClick={() => onSort("slBestMaxRoiPct")}>Best ROI before SL</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.symbol}>
              <td>{row.symbol}</td>
              <td>{row.tpTrades}</td>
              <td>{fmtPct(row.tpWorstMinRoiPct)}</td>
              <td>{row.slTrades}</td>
              <td>{fmtPct(row.slBestMaxRoiPct)}</td>
            </tr>
          ))}
          {!visibleRows.length ? (
            <tr>
              <td colSpan={5} style={{ opacity: 0.75 }}>No data yet.</td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <TablePaginationControls
        tableId="dashboard-trade-excursions"
        page={pageClamped}
        totalRows={sortedRows.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
