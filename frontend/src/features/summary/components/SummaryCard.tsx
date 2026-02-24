import { Badge, Card } from "react-bootstrap";
import type { PaperSummary } from "../types";
import { fmtMoney, fmtNum, fmtTime } from "../../../shared/utils/format";

type Props = {
  summary: PaperSummary;
};

function pct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${fmtNum(v)}%`;
}

export function SummaryCard({ summary }: Props) {
  const trades = summary.trades ?? {};
  const pnl = summary.pnl ?? {};
  const eq = summary.equity ?? {};

  return (
    <Card className="mb-2">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>Paper summary</b>
        {summary.sessionId ? <Badge bg="secondary">{summary.sessionId}</Badge> : null}
        <span style={{ opacity: 0.75, fontSize: 12 }}>
          generated: {summary.generatedAt ? fmtTime(summary.generatedAt) : "—"}
        </span>
      </Card.Header>

      <Card.Body style={{ fontSize: 13 }}>
        <div className="d-flex flex-wrap gap-3">
          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Duration</div>
            <div>{summary.durationSec == null ? "—" : `${fmtNum(summary.durationSec)} sec`}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Trades</div>
            <div>
              {trades.total ?? 0} (W {trades.wins ?? 0} / L {trades.losses ?? 0})
            </div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Win rate</div>
            <div>{pct(trades.winRate == null ? null : trades.winRate * 100)}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Net realized</div>
            <div>{fmtMoney(pnl.netRealized ?? 0)}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Fees</div>
            <div>{fmtMoney(pnl.fees ?? 0)}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Funding</div>
            <div>{fmtMoney(pnl.funding ?? 0)}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Max DD</div>
            <div>{eq.maxDrawdown == null ? "—" : fmtMoney(eq.maxDrawdown)}</div>
          </div>

          <div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Avg hold</div>
            <div>{trades.avgHoldSec == null ? "—" : `${fmtNum(trades.avgHoldSec)} sec`}</div>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
