import { Badge, Card } from "react-bootstrap";
import { fmtMoney, fmtNum, formatFee } from "../../../shared/utils/format";
import type { BotStats } from "../../../shared/types/domain";

type Props = {
  sessionState: "STOPPED" | "RUNNING" | "STOPPING" | "PAUSED" | "PAUSING" | "RESUMING";
  botStats: BotStats;
  uptimeText: string | null;
};

function pct(v: number): string {
  return `${fmtNum(v)}%`;
}

function timeAgo(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return "-";
  const deltaSec = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  return `${deltaSec}s ago`;
}

export function BotSummaryBar({ sessionState, botStats, uptimeText }: Props) {
  const total = botStats.closedTrades;
  const winRate = total > 0 ? (botStats.wins / total) * 100 : 0;
  const isDemo = botStats.executionMode === "demo" && !!botStats.demoStats;

  const stateBadge =
    sessionState === "RUNNING" ? <Badge bg="success">{`RUNNING${uptimeText ? ` · ${uptimeText}` : ""}`}</Badge> :
    sessionState === "STOPPING" || sessionState === "PAUSING" || sessionState === "RESUMING" ? <Badge bg="warning">{sessionState}</Badge> :
    sessionState === "PAUSED" ? <Badge bg="secondary">PAUSED</Badge> :
    <Badge bg="secondary">STOPPED</Badge>;

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>Bot stats</b>
        {stateBadge}
      </Card.Header>

      <Card.Body style={{ fontSize: 13 }}>
        <div className="d-flex flex-wrap gap-3">
          {isDemo ? (
            <>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Demo positions/orders</div>
                <div>positions: {botStats.demoStats?.openPositions ?? 0} · orders: {botStats.demoStats?.openOrders ?? 0}</div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Demo pending</div>
                <div>entries: {botStats.demoStats?.pendingEntries ?? 0}</div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Last reconcile</div>
                <div>{timeAgo(botStats.demoStats?.lastReconcileAtMs ?? 0)}</div>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
