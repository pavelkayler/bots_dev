import { Table } from "react-bootstrap";
import type { TradeExcursionsRow } from "../api/tradeStatsApi";

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v.toFixed(2)}%`;
}

export function TradeExcursionsTable({ rows }: { rows: TradeExcursionsRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <Table striped bordered hover size="sm" className="mb-0">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>TP trades</th>
            <th>Worst ROI before TP</th>
            <th>SL trades</th>
            <th>Best ROI before SL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol}>
              <td>{row.symbol}</td>
              <td>{row.tpTrades}</td>
              <td>{fmtPct(row.tpWorstMinRoiPct)}</td>
              <td>{row.slTrades}</td>
              <td>{fmtPct(row.slBestMaxRoiPct)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
