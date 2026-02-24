import { useMemo, useState } from "react";
import { Badge, Button, Card, Container, Form } from "react-bootstrap";
import { useWsFeed } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import { LiveRowsTable } from "../../features/market/components/LiveRowsTable";
import { EventsTail } from "../../features/events/components/EventsTail";
import { RawWsMessage } from "../../features/raw/components/RawWsMessage";
import { HeaderBar } from "./components/HeaderBar";
import { SessionMetaBar } from "./components/SessionMetaBar";
import { BotSummaryBar } from "./components/BotSummaryBar";
import type { SymbolRow } from "../../shared/types/domain";
import { ConfigPanel } from "../../features/config/components/ConfigPanel";
import { SessionSummaryPanel } from "../../features/summary/components/SessionSummaryPanel";

export function DashboardPage() {
  const {
    conn,
    rows,
    lastServerTime,
    lastMsg,
    wsUrl,
    streams,
    universeSelectedId,
    universeSymbolsCount,
    events,
    botStats,
    requestEventsTail,
    requestRowsRefresh
  } = useWsFeed();

  const { status, busy, error, start, stop, canStart, canStop } = useSessionRuntime();

  const [activeOnly, setActiveOnly] = useState(true);

  const universeReady = Boolean(universeSelectedId) && universeSymbolsCount > 0;
  const canStartFinal = canStart && universeReady;

  const displayedRows = useMemo(() => {
    if (!activeOnly) return rows;

    return rows.filter((r: SymbolRow) => {
      const paperActive = r.paperStatus === "ENTRY_PENDING" || r.paperStatus === "OPEN";
      const hasSignal = r.signal === "LONG" || r.signal === "SHORT";
      return paperActive || hasSignal;
    });
  }, [rows, activeOnly]);

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
      />

      <Container fluid className="py-2 px-2">
        <SessionMetaBar
          sessionId={status.sessionId}
          eventsFile={status.eventsFile}
          apiError={error}
        />

        <BotSummaryBar sessionState={status.sessionState} botStats={botStats} />

        <SessionSummaryPanel sessionState={status.sessionState} sessionId={status.sessionId} />

        <ConfigPanel sessionState={status.sessionState} />

        <Card className="mb-3">
          <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
            <b>Live rows (1Hz)</b>
            <div className="ms-auto d-flex align-items-center gap-2">
              <Form.Check type="switch" id="active-only" label="Active only" checked={activeOnly} onChange={(e) => setActiveOnly(e.currentTarget.checked)} />
              <Badge bg="secondary">rows: {displayedRows.length}</Badge>
              <Button size="sm" variant="outline-secondary" onClick={() => requestRowsRefresh("tick")}>
                Refresh rows
              </Button>
            </div>
          </Card.Header>
          <Card.Body>
            <LiveRowsTable rows={displayedRows} />
          </Card.Body>
        </Card>

        <EventsTail enabled={status.sessionState === "RUNNING"} events={events} onRequestTail={requestEventsTail} />

        <RawWsMessage value={lastMsg} />
      </Container>
    </>
  );
}
