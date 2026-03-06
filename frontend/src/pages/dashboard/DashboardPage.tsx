import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Container, Form } from "react-bootstrap";
import { useWsFeed } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import { LiveRowsTable } from "../../features/market/components/LiveRowsTable";
import { EventsTail } from "../../features/events/components/EventsTail";
import { HeaderBar } from "./components/HeaderBar";
import { SessionMetaBar } from "./components/SessionMetaBar";
import { BotSummaryBar } from "./components/BotSummaryBar";
import type { SymbolRow } from "../../shared/types/domain";
import { ExecutionPanel } from "../../features/config/components/ExecutionPanel";
import { SessionSummaryPanel } from "../../features/summary/components/SessionSummaryPanel";
import { TradeStatsTabs } from "../../features/stats/components/TradeStatsTabs";
import { BotExecutionSelectors } from "../../features/bots/components/BotExecutionSelectors";

export function DashboardPage() {
  const {
    conn,
    rows,
    lastServerTime,
    wsUrl,
    wsSessionState,
    wsSessionId,
    wsRunningSinceMs,
    streams,
    events,
    botStats,
    requestEventsTail,
    requestRowsRefresh
  } = useWsFeed();

  const { status, busy, error, start, stop, pause, resume, canStart, canStop, canPause, canResume } = useSessionRuntime();

  const [activeOnly, setActiveOnly] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draftKlineTfMin] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const canStartFinal = canStart;

  const displayedRows = useMemo(() => {
    if (!activeOnly) return rows;

    return rows.filter((r: SymbolRow) => {
      const paperActive = r.paperStatus === "ENTRY_PENDING" || r.paperStatus === "OPEN";
      const hasSignal = r.signal === "LONG" || r.signal === "SHORT";
      return paperActive || hasSignal;
    });
  }, [rows, activeOnly]);

  function parseSessionStartTs(sessionId: string | null): number | null {
    if (!sessionId) return null;
    const match = sessionId.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
    if (match) {
      const [, date, hh, mm, ss, ms] = match;
      const parsed = Date.parse(`${date}T${hh}:${mm}:${ss}.${ms}Z`);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const parsed = Date.parse(sessionId);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    if (hh > 0) {
      return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
    }
    return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  }

  const runningSinceMs = wsSessionState === "RUNNING" ? wsRunningSinceMs : status.runningSinceMs ?? null;
  const runningSessionId = wsSessionState === "RUNNING" ? wsSessionId : status.sessionId;
  const sessionStartTs = useMemo(() => runningSinceMs ?? parseSessionStartTs(runningSessionId), [runningSessionId, runningSinceMs]);
  const uptimeText = (wsSessionState === "RUNNING" || status.sessionState === "RUNNING") && sessionStartTs != null ? formatElapsed(nowMs - sessionStartTs) : null;

  const klineTfMin = Number(draftKlineTfMin || 1);
  const tfMs = Math.max(1, klineTfMin) * 60_000;
  const remMs = tfMs - (nowMs % tfMs);
  const remMin = Math.floor(remMs / 60_000);
  const remSec = Math.floor((remMs % 60_000) / 1000);
  const nextCandle = `${remMin}:${remSec.toString().padStart(2, "0")}`;



  return (
    <>
      <HeaderBar
        conn={conn}
        sessionState={status.sessionState}
        wsUrl={wsUrl}
        lastServerTime={lastServerTime}
        streams={streams}
        canStart={canStartFinal}
        canStop={canStop}
        busy={busy}
        onStart={() => void start()}
        onStop={() => void stop()}
        onPause={() => void pause()}
        onResume={() => void resume()}
        canPause={canPause}
        canResume={canResume}
      />

      <Container fluid className="py-2 px-2">
        <SessionMetaBar
          sessionId={status.sessionId}
          eventsFile={status.eventsFile}
          apiError={error}
          runtimeMessage={status.runtimeMessage ?? null}
        />

        <BotSummaryBar sessionState={status.sessionState} botStats={botStats} uptimeText={uptimeText} />

        <SessionSummaryPanel sessionState={status.sessionState} sessionId={status.sessionId} executionMode={botStats.executionMode ?? "paper"} suppressStopRefresh={false} />

        <BotExecutionSelectors />
        <ExecutionPanel />

        <Card className="mb-3">
          <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
            <b>Live rows (1Hz)</b>
            <div className="ms-auto d-flex align-items-center gap-2 flex-wrap">
              <Form.Check type="switch" id="active-only" label="Active only" checked={activeOnly} onChange={(e) => setActiveOnly(e.currentTarget.checked)} />
              <Badge bg="secondary">rows: {displayedRows.length}</Badge>
              <span style={{ fontSize: 12, opacity: 0.85 }}>Next candle in: {nextCandle}</span>
              <Button size="sm" variant="outline-secondary" onClick={() => requestRowsRefresh("tick")}>
                Refresh rows
              </Button>
            </div>
          </Card.Header>
          <Card.Body>
            <LiveRowsTable rows={displayedRows} />
          </Card.Body>
        </Card>

        <Card className="mb-3">
          <Card.Header>
            <b>Trade stats by symbol</b>
          </Card.Header>
          <Card.Body>
            <TradeStatsTabs rows={rows} />
          </Card.Body>
        </Card>

        <EventsTail enabled={status.sessionState === "RUNNING"} events={events} onRequestTail={requestEventsTail} />
      </Container>
    </>
  );
}

