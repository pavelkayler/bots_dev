import { Button, Card, Spinner } from "react-bootstrap";
import type { SessionState } from "../../../shared/types/domain";
import { getSummaryDownloadUrl } from "../api/summaryApi";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { fmtTime } from "../../../shared/utils/format";
import { SummaryCard } from "./SummaryCard";
import { TradesTable } from "./TradesTable";

type Props = {
  sessionState: SessionState;
  sessionId: string | null;
};

export function SessionSummaryPanel({ sessionState, sessionId }: Props) {
  const { data, loading, error, lastUpdatedAt, refresh } = useSessionSummary(sessionState, sessionId);

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>Summary</b>
        <span style={{ opacity: 0.75, fontSize: 12 }}>
          {lastUpdatedAt ? `updated: ${fmtTime(lastUpdatedAt)}` : ""}
        </span>

        <div className="ms-auto d-flex align-items-center gap-2">
          <Button size="sm" variant="outline-secondary" onClick={() => void refresh()} disabled={loading || !sessionId}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => window.open(getSummaryDownloadUrl(), "_blank", "noopener,noreferrer")}
            disabled={!data}
          >
            Download
          </Button>
        </div>
      </Card.Header>

      <Card.Body>
        {!sessionId ? (
          <div style={{ opacity: 0.75 }}>
            No session yet. Start and stop a paper session to generate summary.
          </div>
        ) : loading ? (
          <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
            <Spinner animation="border" size="sm" />
            loading…
          </div>
        ) : error ? (
          <div style={{ color: "#b00020" }}>{error}</div>
        ) : !data ? (
          <div style={{ opacity: 0.75 }}>
            No summary yet. Stop a paper session to generate summary.json.
          </div>
        ) : (
          <>
            <SummaryCard summary={data.summary} />
            <TradesTable trades={data.trades ?? []} />
          </>
        )}
      </Card.Body>
    </Card>
  );
}
