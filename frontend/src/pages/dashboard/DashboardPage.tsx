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

  const [activeOnly, setActiveOnly] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isRebooting, setIsRebooting] = useState(false);
  const [draftKlineTfMin, setDraftKlineTfMin] = useState(1);
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

  function parseSessionStartTs(sessionId: string | null): number | null {
    if (!sessionId) return null;
    const maybeIso = sessionId.replace(/-/g, ":").replace(/:(\d{3})$/, ".$1");
    const parsed = Date.parse(maybeIso);
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

  const runningSessionId = wsSessionState === "RUNNING" ? wsSessionId : status.sessionId;
  const sessionStartTs = useMemo(() => parseSessionStartTs(runningSessionId), [runningSessionId]);
  const uptimeText = (wsSessionState === "RUNNING" || status.sessionState === "RUNNING") && sessionStartTs != null ? formatElapsed(nowMs - sessionStartTs) : null;

  const klineTfMin = Number(draftKlineTfMin || 1);
  const tfMs = Math.max(1, klineTfMin) * 60_000;
  const remMs = tfMs - (nowMs % tfMs);
  const remMin = Math.floor(remMs / 60_000);
  const remSec = Math.floor((remMs % 60_000) / 1000);
  const nextCandle = `${remMin}:${remSec.toString().padStart(2, "0")}`;

  const tradeStats = useTradeStatsBySymbol(status.sessionState, status.sessionId, eventStream);

  const enrichedTradeStats = useMemo(() => {
    const marketBySymbol = new Map<string, { turnover24hUsd: number | null; volatility24hPct: number | null }>();

    for (const row of rows) {
      const turnover24hUsd = typeof row.turnover24hUsd === "number" && Number.isFinite(row.turnover24hUsd) ? row.turnover24hUsd : null;
      const highPrice24h = typeof row.highPrice24h === "number" && Number.isFinite(row.highPrice24h) ? row.highPrice24h : null;
      const lowPrice24h = typeof row.lowPrice24h === "number" && Number.isFinite(row.lowPrice24h) ? row.lowPrice24h : null;
      const volatility24hPct =
        highPrice24h != null && lowPrice24h != null && lowPrice24h > 0
          ? ((highPrice24h - lowPrice24h) / lowPrice24h) * 100
          : null;
      marketBySymbol.set(row.symbol, { turnover24hUsd, volatility24hPct });
    }

    return tradeStats.map((stat) => ({
      ...stat,
      turnover24hUsd: marketBySymbol.get(stat.symbol)?.turnover24hUsd ?? null,
      volatility24hPct: marketBySymbol.get(stat.symbol)?.volatility24hPct ?? null,
    }));
  }, [rows, tradeStats]);

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

        <BotSummaryBar sessionState={status.sessionState} botStats={botStats} uptimeText={uptimeText} />

        <SessionSummaryPanel sessionState={status.sessionState} sessionId={status.sessionId} suppressStopRefresh={isRebooting} />

        <ConfigPanel sessionState={status.sessionState} rebooting={isRebooting} onApplyAndReboot={onApplyAndReboot} onDraftKlineTfMinChange={setDraftKlineTfMin} />

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
            <TradeStatsBySymbolTable stats={enrichedTradeStats} />
          </Card.Body>
        </Card>

        <EventsTail enabled={status.sessionState === "RUNNING"} events={events} onRequestTail={requestEventsTail} />

        <RawWsMessage value={lastMsg} />
      </Container>
    </>
  );
}
