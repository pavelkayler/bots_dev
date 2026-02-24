import { useMemo, useState } from "react";
import { Container } from "react-bootstrap";
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
          activeOnly={activeOnly}
          onToggleActiveOnly={setActiveOnly}
          rowsCount={displayedRows.length}
          apiError={error}
          onRefreshRows={() => requestRowsRefresh("tick")}
        />

        <BotSummaryBar sessionState={status.sessionState} botStats={botStats} />

        <SessionSummaryPanel sessionState={status.sessionState} sessionId={status.sessionId} />

        <ConfigPanel sessionState={status.sessionState} />

        <h4 className="mb-2">Live rows (1Hz)</h4>
        <LiveRowsTable rows={displayedRows} />

        <EventsTail enabled={status.sessionState === "RUNNING"} events={events} onRequestTail={requestEventsTail} />

        <RawWsMessage value={lastMsg} />
      </Container>
    </>
  );
}
