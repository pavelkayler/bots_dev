import { useMemo, useState } from "react";
import { Badge, Form, Pagination, Table } from "react-bootstrap";
import type { PaperTrade } from "../types";
import { fmtMoney, fmtNum, fmtTime, formatFee } from "../../../shared/utils/format";

type Props = {
  trades: PaperTrade[];
};

type SortKey = "symbol" | "side" | "openedAt" | "closedAt" | "entryPrice" | "closePrice" | "qty" | "closeType" | "realizedPnl" | "feesPaid";

function sideBadge(side: string | undefined) {
  if (!side) return <Badge bg="secondary">—</Badge>;
  return side === "LONG" ? <Badge bg="success">LONG</Badge> : side === "SHORT" ? <Badge bg="danger">SHORT</Badge> : <Badge bg="secondary">{side}</Badge>;
}

export function TradesTable({ trades }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("closedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const sortedTrades = useMemo(() => {
    const withIndex = trades.map((trade, idx) => ({ trade, idx }));
    withIndex.sort((a, b) => {
      const left = a.trade;
      const right = b.trade;

      const str = (v: string | undefined | null) => (v ?? "").toString();
      const num = (v: number | undefined | null) => (Number.isFinite(v) ? Number(v) : 0);

      let cmp = 0;
      if (sortKey === "symbol" || sortKey === "side" || sortKey === "closeType") {
        const lv = sortKey === "symbol" ? str(left.symbol) : sortKey === "side" ? str(left.side) : str(left.closeType);
        const rv = sortKey === "symbol" ? str(right.symbol) : sortKey === "side" ? str(right.side) : str(right.closeType);
        cmp = lv.localeCompare(rv);
      } else if (sortKey === "openedAt" || sortKey === "closedAt" || sortKey === "entryPrice" || sortKey === "closePrice" || sortKey === "qty" || sortKey === "realizedPnl" || sortKey === "feesPaid") {
        const lv = sortKey === "openedAt"
          ? num(left.openedAt)
          : sortKey === "closedAt"
            ? num(left.closedAt)
            : sortKey === "entryPrice"
              ? num(left.entryPrice)
              : sortKey === "closePrice"
                ? num(left.closePrice)
                : sortKey === "qty"
                  ? num(left.qty)
                  : sortKey === "realizedPnl"
                    ? num(left.realizedPnl)
                    : num(left.feesPaid);
        const rv = sortKey === "openedAt"
          ? num(right.openedAt)
          : sortKey === "closedAt"
            ? num(right.closedAt)
            : sortKey === "entryPrice"
              ? num(right.entryPrice)
              : sortKey === "closePrice"
                ? num(right.closePrice)
                : sortKey === "qty"
                  ? num(right.qty)
                  : sortKey === "realizedPnl"
                    ? num(right.realizedPnl)
                    : num(right.feesPaid);
        cmp = lv - rv;
      }

      if (cmp === 0) return a.idx - b.idx;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return withIndex.map((x) => x.trade);
  }, [sortDir, sortKey, trades]);

  const totalPages = Math.max(1, Math.ceil(sortedTrades.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const start = (page - 1) * pageSize;
  const visibleTrades = sortedTrades.slice(start, start + pageSize);

  function onSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      setCurrentPage(1);
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
    setCurrentPage(1);
  }

  if (!trades.length) {
    return (
      <div style={{ opacity: 0.75, fontSize: 13 }}>
        No trades in summary.
      </div>
    );
  }

  const th: React.CSSProperties = { fontSize: 12, padding: "4px 6px", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" };
  const td: React.CSSProperties = { fontSize: 12, padding: "4px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <>
      <Table striped bordered hover size="sm" style={{ tableLayout: "fixed", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: "10%" }} onClick={() => onSort("symbol")}>Symbol</th>
            <th style={{ ...th, width: "9%" }} onClick={() => onSort("side")}>Side</th>
            <th style={{ ...th, width: "12%" }} onClick={() => onSort("openedAt")}>Opened</th>
            <th style={{ ...th, width: "12%" }} onClick={() => onSort("closedAt")}>Closed</th>
            <th style={{ ...th, width: "10%" }} onClick={() => onSort("entryPrice")}>Entry</th>
            <th style={{ ...th, width: "10%" }} onClick={() => onSort("closePrice")}>Close</th>
            <th style={{ ...th, width: "10%" }} onClick={() => onSort("qty")}>Qty</th>
            <th style={{ ...th, width: "9%" }} onClick={() => onSort("closeType")}>Type</th>
            <th style={{ ...th, width: "9%" }} onClick={() => onSort("realizedPnl")}>PnL</th>
            <th style={{ ...th, width: "9%" }} onClick={() => onSort("feesPaid")}>Fees</th>
          </tr>
        </thead>
        <tbody>
          {visibleTrades.map((t, i) => (
            <tr key={`${t.symbol ?? "?"}-${t.openedAt ?? 0}-${i}`}>
              <td style={td}>{t.symbol ?? "—"}</td>
              <td style={td}>{sideBadge(t.side)}</td>
              <td style={td}>{t.openedAt ? fmtTime(t.openedAt) : "—"}</td>
              <td style={td}>{t.closedAt ? fmtTime(t.closedAt) : "—"}</td>
              <td style={td}>{t.entryPrice == null ? "—" : fmtNum(t.entryPrice)}</td>
              <td style={td}>{t.closePrice == null ? "—" : fmtNum(t.closePrice)}</td>
              <td style={td}>{t.qty == null ? "—" : fmtNum(t.qty)}</td>
              <td style={td}>{t.closeType ?? "—"}</td>
              <td style={td}>{fmtMoney(t.realizedPnl ?? 0)}</td>
              <td style={td}>{formatFee(t.feesPaid ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="d-flex align-items-center justify-content-between">
        <Pagination size="sm" className="mb-0">
          <Pagination.Prev disabled={page <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} />
          <Pagination.Item active>{page}</Pagination.Item>
          <Pagination.Next disabled={page >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} />
        </Pagination>

        <div className="d-flex align-items-center gap-2">
          <span style={{ fontSize: 12, opacity: 0.8 }}>Rows</span>
          <Form.Select
            size="sm"
            value={pageSize}
            style={{ width: 90 }}
            onChange={(e) => {
              setPageSize(Number(e.currentTarget.value));
              setCurrentPage(1);
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </Form.Select>
        </div>
      </div>
    </>
  );
}
