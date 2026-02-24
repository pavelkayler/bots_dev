import { useEffect, useMemo, useRef, useState } from "react";
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
import { useRuntimeConfig } from "../../features/config/hooks/useRuntimeConfig";
import { useTradeStatsBySymbol } from "../../features/stats/hooks/useTradeStatsBySymbol";
import { TradeStatsBySymbolTable } from "../../features/stats/components/TradeStatsBySymbolTable";

export function DashboardPage() {
  const {
    conn,
    rows,
    lastServerTime,
    lastMsg,
    wsUrl,
    wsSessionState,
    wsSessionId,
    streams,
    universeSelectedId,
    universeSymbolsCount,
    events,
    eventStream,
    botStats,
    requestEventsTail,
    requestRowsRefresh
  } = useWsFeed();

  const { status, busy, error, start, stop, canStart, canStop } = useSessionRuntime();
  const { config } = useRuntimeConfig();

  const [activeOnly, setActiveOnly] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isRebooting, setIsRebooting] = useState(false);
  const wsSessionStateRef = useRef(wsSessionState);
  const wsSessionIdRef = useRef(wsSessionId);
  const waitersRef = useRef<Array<{ predicate: () => boolean; resolve: () => void }>>([]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);


  useEffect(() => {
    wsSessionStateRef.current = wsSessionState;
    wsSessionIdRef.current = wsSessionId;
    const remaining: Array<{ predicate: () => boolean; resolve: () => void }> = [];
    for (const waiter of waitersRef.current) {
      if (waiter.predicate()) waiter.resolve();
      else remaining.push(waiter);
    }
    waitersRef.current = remaining;
  }, [wsSessionState, wsSessionId]);

  function waitForWs(predicate: () => boolean) {
    if (predicate()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      waitersRef.current.push({ predicate, resolve });
    });
  }

  async function onApplyAndReboot() {
    const previousSessionId = wsSessionIdRef.current;
    setIsRebooting(true);
    try {
      if (wsSessionStateRef.current === "RUNNING") {
        await stop();
        await waitForWs(() => wsSessionStateRef.current === "STOPPED");
      }
      await start();
      await waitForWs(() => wsSessionStateRef.current === "RUNNING" && Boolean(wsSessionIdRef.current) && wsSessionIdRef.current !== previousSessionId);
    } finally {
      setIsRebooting(false);
    }
  }

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

  const klineTfMin = Number(config?.universe?.klineTfMin ?? 1);
  const tfMs = Math.max(1, klineTfMin) * 60_000;
  const remMs = tfMs - (nowMs % tfMs);
  const remMin = Math.floor(remMs / 60_000);
  const remSec = Math.floor((remMs % 60_000) / 1000);
  const nextCandle = `${remMin}:${remSec.toString().padStart(2, "0")}`;

  const tradeStats = useTradeStatsBySymbol(status.sessionState, status.sessionId, eventStream);

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

        <SessionSummaryPanel sessionState={status.sessionState} sessionId={status.sessionId} suppressStopRefresh={isRebooting} />

        <ConfigPanel sessionState={status.sessionState} rebooting={isRebooting} onApplyAndReboot={onApplyAndReboot} />

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
            <TradeStatsBySymbolTable stats={tradeStats} />
          </Card.Body>
        </Card>

        <EventsTail enabled={status.sessionState === "RUNNING"} events={events} onRequestTail={requestEventsTail} />

        <RawWsMessage value={lastMsg} />
      </Container>
    </>
  );
}
