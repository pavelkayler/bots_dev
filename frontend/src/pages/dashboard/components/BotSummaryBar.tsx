import { Badge, Card } from "react-bootstrap";
import { fmtMoney, fmtNum, formatFee } from "../../../shared/utils/format";
import type { BotStats } from "../../../shared/types/domain";

type Props = {
  sessionState: "STOPPED" | "RUNNING" | "STOPPING";
  botStats: BotStats;
  uptime: string | null;
};

function pct(v: number): string {
  return `${fmtNum(v)}%`;
}

export function BotSummaryBar({ sessionState, botStats, uptime }: Props) {
  const total = botStats.closedTrades;
  const winRate = total > 0 ? (botStats.wins / total) * 100 : 0;

  const stateBadge =
    sessionState === "RUNNING" ? <Badge bg="success">RUNNING</Badge> :
    sessionState === "STOPPING" ? <Badge bg="warning">STOPPING</Badge> :
    <Badge bg="secondary">STOPPED</Badge>;

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>Bot stats</b>
        {stateBadge}
        {sessionState === "RUNNING" && uptime ? <span style={{ fontSize: 12, opacity: 0.85 }}>uptime: {uptime}</span> : null}
      </Card.Header>

      <Card.Body style={{ fontSize: 13 }}>
        <div className="d-flex flex-wrap gap-3">
          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Paper positions</div>
            <div>open: {botStats.openPositions} · pending: {botStats.pendingOrders}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>PnL</div>
            <div>u: {fmtMoney(botStats.unrealizedPnl)} · r: {fmtMoney(botStats.netRealized)}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Closed trades</div>
            <div>
              {botStats.closedTrades} (W {botStats.wins} / L {botStats.losses}) · win: {pct(winRate)}
            </div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Net realized</div>
            <div>{fmtMoney(botStats.netRealized)}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Fees / Funding</div>
            <div>{formatFee(botStats.feesPaid)} / {fmtMoney(botStats.fundingAccrued)}</div>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
