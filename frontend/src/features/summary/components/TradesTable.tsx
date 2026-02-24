import { Badge, Table } from "react-bootstrap";
import type { PaperTrade } from "../types";
import { fmtMoney, fmtNum, fmtTime } from "../../../shared/utils/format";

type Props = {
  trades: PaperTrade[];
};

function sideBadge(side: string | undefined) {
  if (!side) return <Badge bg="secondary">—</Badge>;
  return side === "LONG" ? <Badge bg="success">LONG</Badge> : side === "SHORT" ? <Badge bg="danger">SHORT</Badge> : <Badge bg="secondary">{side}</Badge>;
}

export function TradesTable({ trades }: Props) {
  if (!trades.length) {
    return (
      <div style={{ opacity: 0.75, fontSize: 13 }}>
        No trades in summary.
      </div>
    );
  }

  const th: React.CSSProperties = { fontSize: 12, padding: "4px 6px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 12, padding: "4px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <Table striped bordered hover size="sm" style={{ tableLayout: "fixed", width: "100%" }}>
      <thead>
        <tr>
          <th style={{ ...th, width: "10%" }}>Symbol</th>
          <th style={{ ...th, width: "9%" }}>Side</th>
          <th style={{ ...th, width: "12%" }}>Opened</th>
          <th style={{ ...th, width: "12%" }}>Closed</th>
          <th style={{ ...th, width: "10%" }}>Entry</th>
          <th style={{ ...th, width: "10%" }}>Close</th>
          <th style={{ ...th, width: "10%" }}>Qty</th>
          <th style={{ ...th, width: "9%" }}>Type</th>
          <th style={{ ...th, width: "9%" }}>PnL</th>
          <th style={{ ...th, width: "9%" }}>Fees</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t, i) => (
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
            <td style={td}>{fmtMoney(t.feesPaid ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
