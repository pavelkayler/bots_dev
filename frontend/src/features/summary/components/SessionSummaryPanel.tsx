import { useCallback, useEffect, useState } from "react";
import { Button, Card, Spinner } from "react-bootstrap";
import type { DemoSummaryResponse, SessionState } from "../../../shared/types/domain";
import { getSummaryDownloadUrl } from "../api/summaryApi";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { fmtMoney, fmtTime } from "../../../shared/utils/format";
import { fetchDemoSummary, getDemoSummaryDownloadUrl, getRunPackManifestUrl } from "../../session/api/sessionApi";
import { SummaryCard } from "./SummaryCard";
import { TradesTable } from "./TradesTable";

type Props = {
  sessionState: SessionState;
  sessionId: string | null;
  executionMode: "paper" | "demo" | "empty";
  suppressStopRefresh?: boolean;
};

function renderBalance(value: number | null | undefined) {
  return value == null ? "-" : fmtMoney(value);
}

export function SessionSummaryPanel({ sessionState, sessionId, executionMode, suppressStopRefresh }: Props) {
  const { data, loading, error, lastUpdatedAt, refresh } = useSessionSummary(sessionState, sessionId, suppressStopRefresh);
  const [demoSummary, setDemoSummary] = useState<DemoSummaryResponse | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const refreshDemo = useCallback(async () => {
    if (!sessionId) return;
    setDemoLoading(true);
    setDemoError(null);
    try {
      const result = await fetchDemoSummary();
      setDemoSummary(result);
    } catch (e: any) {
      setDemoError(String(e?.message ?? e));
    } finally {
      setDemoLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionState === "RUNNING" && sessionId && executionMode === "demo") {
      setDemoSummary(null);
      setDemoError(null);
      setDemoLoading(false);
    }
  }, [sessionState, sessionId, executionMode]);

  useEffect(() => {
    if (!sessionId || executionMode !== "demo") return;
    if (sessionState !== "RUNNING" && !suppressStopRefresh) {
      void refreshDemo();
    }
  }, [sessionState, sessionId, suppressStopRefresh, executionMode, refreshDemo]);

  const downloadUrl = executionMode === "demo" ? getDemoSummaryDownloadUrl() : getSummaryDownloadUrl();

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>{executionMode === "demo" ? "Demo summary" : "Summary"}</b>
        <span style={{ opacity: 0.75, fontSize: 12 }}>
          {lastUpdatedAt ? `updated: ${fmtTime(lastUpdatedAt)}` : ""}
        </span>

        <div className="ms-auto d-flex align-items-center gap-2">
          <Button size="sm" variant="outline-secondary" onClick={() => void (executionMode === "demo" ? refreshDemo() : refresh())} disabled={executionMode === "demo" ? demoLoading || !sessionId : loading || !sessionId}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => window.open(downloadUrl, "_blank", "noopener,noreferrer")}
            disabled={executionMode === "demo" ? !demoSummary : !data}
          >
            Download
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => window.open(getRunPackManifestUrl(), "_blank", "noopener,noreferrer")}
            disabled={!sessionId}
          >
            Run pack
          </Button>
        </div>
      </Card.Header>

      <Card.Body>
        {!sessionId ? (
          <div style={{ opacity: 0.75 }}>
            No session yet. Start and stop a session to generate summary.
          </div>
        ) : executionMode === "demo" ? (
          demoLoading ? (
            <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
              <Spinner animation="border" size="sm" />
              loading…
            </div>
          ) : demoError ? (
            <div style={{ color: "#b00020" }}>{demoError}</div>
          ) : !demoSummary ? (
            <div style={{ opacity: 0.75 }}>No demo summary yet. Stop a demo session to generate demo_summary.json.</div>
          ) : (
            <div className="d-grid gap-1">
              <div><b>Start balance (USDT):</b> {renderBalance(demoSummary.startBalanceUsdt)}</div>
              <div><b>End balance (USDT):</b> {renderBalance(demoSummary.endBalanceUsdt)}</div>
              <div><b>Delta (USDT):</b> {renderBalance(demoSummary.deltaUsdt)}</div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>
                Open positions at end: {demoSummary.openPositionsAtEnd} · Open orders at end: {demoSummary.openOrdersAtEnd} · Pending entries at end: {demoSummary.pendingEntriesAtEnd}
              </div>
            </div>
          )
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
