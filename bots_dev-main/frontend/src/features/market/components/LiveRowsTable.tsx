import { Badge, Table } from "react-bootstrap";
import type { SymbolRow } from "../../../shared/types/domain";
import { fmtNum, fmtPct, fmtMoney, fmtTime } from "../../../shared/utils/format";

type Props = {
  rows?: SymbolRow[];
};

export function LiveRowsTable({ rows }: Props) {
  const safeRows = Array.isArray(rows) ? rows : [];

  const thBase: React.CSSProperties = {
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    fontSize: 12,
    padding: "4px 6px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const tdBase: React.CSSProperties = {
    verticalAlign: "middle",
    fontSize: 12,
    padding: "4px 6px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const mono: React.CSSProperties = {
    fontVariantNumeric: "tabular-nums",
  };

  const sub: React.CSSProperties = {
    opacity: 0.75,
    fontSize: 11,
    lineHeight: "14px",
  };

  // widths in % (sum ~= 100)
  const w = {
    symbol: "8%",
    mark: "9%",
    oiv: "10%",
    funding: "12%",
    moves: "12%",
    cooldown: "8%",
    signal: "18%",
    paper: "9%",
    levels: "8%",
    pnl: "8%",
    upd: "6%",
  } as const;

  function signalBadge(signal: "LONG" | "SHORT" | null | undefined) {
    if (!signal) return <Badge bg="secondary">—</Badge>;
    return signal === "LONG" ? <Badge bg="success">LONG</Badge> : <Badge bg="danger">SHORT</Badge>;
  }

  function cooldownBadge(active: boolean | undefined) {
    if (!active) return <Badge bg="secondary">—</Badge>;
    return <Badge bg="info">ON</Badge>;
  }

  function paperBadge(status: SymbolRow["paperStatus"] | undefined) {
    if (!status) return <Badge bg="secondary">—</Badge>;
    if (status === "OPEN") return <Badge bg="primary">OPEN</Badge>;
    if (status === "ENTRY_PENDING") return <Badge bg="warning">ENTRY</Badge>;
    return <Badge bg="secondary">IDLE</Badge>;
  }

  return (
    <div style={{ width: "100%", maxWidth: "100%" }}>
      <Table striped bordered hover size="sm" style={{ tableLayout: "fixed", width: "100%", marginBottom: 0 }}>
        <thead>
          <tr>
            <th style={{ ...thBase, width: w.symbol }}>Symbol</th>
            <th style={{ ...thBase, width: w.mark }}>Mark</th>
            <th style={{ ...thBase, width: w.oiv }}>OIV</th>
            <th style={{ ...thBase, width: w.funding }}>Funding</th>
            <th style={{ ...thBase, width: w.moves }}>Moves</th>
            <th style={{ ...thBase, width: w.cooldown }}>Cooldown</th>
            <th style={{ ...thBase, width: w.signal }}>Signal / Reason</th>
            <th style={{ ...thBase, width: w.paper }}>Paper</th>
            <th style={{ ...thBase, width: w.levels }}>Entry / TP / SL</th>
            <th style={{ ...thBase, width: w.pnl }}>PnL</th>
            <th style={{ ...thBase, width: w.upd }}>Upd</th>
          </tr>
        </thead>

        <tbody>
          {safeRows.map((r) => {
            const nextFunding = fmtTime(r.nextFundingTime);
            const cooldownUntil = r.cooldownWindowEndMs ? fmtTime(r.cooldownWindowEndMs) : null;

            return (
              <tr key={r.symbol}>
                <td style={{ ...tdBase, ...mono, width: w.symbol, whiteSpace: "nowrap" }}>{r.symbol}</td>

                <td style={{ ...tdBase, ...mono, width: w.mark, whiteSpace: "nowrap" }}>{fmtNum(r.markPrice)}</td>

                <td style={{ ...tdBase, ...mono, width: w.oiv, whiteSpace: "nowrap" }}>{fmtNum(r.openInterestValue)}</td>

                <td style={{ ...tdBase, ...mono, width: w.funding, whiteSpace: "normal" }} title={`funding=${r.fundingRate} next=${nextFunding}`}>
                  <div style={{ whiteSpace: "nowrap" }}>{r.fundingRate}</div>
                  <div style={sub}>next: {nextFunding}</div>
                </td>

                <td style={{ ...tdBase, ...mono, width: w.moves, whiteSpace: "normal" }}>
                  <div style={{ whiteSpace: "nowrap" }}>px: {fmtPct(r.priceMovePct)}</div>
                  <div style={sub}>oi: {fmtPct(r.oivMovePct)}</div>
                </td>

                <td style={{ ...tdBase, width: w.cooldown, whiteSpace: "normal" }} title={cooldownUntil ? `until ${cooldownUntil}` : undefined}>
                  <div>{cooldownBadge(r.cooldownActive)}</div>
                  {r.cooldownActive && cooldownUntil ? <div style={sub}>until: {cooldownUntil}</div> : <div style={sub}>&nbsp;</div>}
                </td>

                <td style={{ ...tdBase, width: w.signal, whiteSpace: "normal" }} title={r.signalReason ?? ""}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {signalBadge(r.signal)}
                    {r.paperStatus ? paperBadge(r.paperStatus) : null}
                  </div>
                  <div style={{ ...sub, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{r.signalReason ?? "—"}</div>
                </td>

                <td style={{ ...tdBase, width: w.paper, whiteSpace: "normal" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {paperBadge(r.paperStatus)}
                    <span style={{ ...sub, opacity: 0.9 }}>{r.paperSide ?? "—"}</span>
                  </div>
                  <div style={sub}>qty: {r.paperQty == null ? "—" : fmtNum(r.paperQty)}</div>
                </td>

                <td style={{ ...tdBase, ...mono, width: w.levels, whiteSpace: "normal" }}>
                  <div style={{ whiteSpace: "nowrap" }}>e: {r.paperEntryPrice == null ? "—" : fmtNum(r.paperEntryPrice)}</div>
                  <div style={sub}>tp: {r.paperTpPrice == null ? "—" : fmtNum(r.paperTpPrice)}</div>
                  <div style={sub}>sl: {r.paperSlPrice == null ? "—" : fmtNum(r.paperSlPrice)}</div>
                </td>

                <td style={{ ...tdBase, ...mono, width: w.pnl, whiteSpace: "normal" }}>
                  <div style={{ whiteSpace: "nowrap" }}>u: {fmtMoney(r.paperUnrealizedPnl)}</div>
                  <div style={sub}>r: {fmtMoney(r.paperRealizedPnl ?? 0)}</div>
                </td>

                <td style={{ ...tdBase, ...mono, width: w.upd, whiteSpace: "nowrap" }}>{fmtTime(r.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
